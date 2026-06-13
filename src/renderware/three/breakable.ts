import type { InstancedMesh, Object3D, Texture } from 'three';

import { Matrix4 } from 'three';

import type { ImgArchive } from '../archive';
import type { RWBreakable, RWBreakableMaterial, RWGeometry } from '../parsers/binary/types';

import { getClump } from '../archive';
import { spawnDebris } from './build-debris';

/**
 * Breakable-prop world registry (plan 045 iteration 3). Mirrors the escalator / animated-object
 * registries: every placed prop whose model carries RW Breakable shatter data registers at cell
 * build ({@link collectBreakables}); a trigger (debugger / vehicle impact) finds the nearest one
 * ({@link nearestBreakable}) and smashes it ({@link breakBreakable}) — the prop's InstancedMesh
 * slots collapse to zero scale and a one-shot debris mesh ({@link spawnDebris}) flies the shards.
 * The matching static collider is dropped by the game layer via the instance {@link key}.
 */
export interface BreakableInstance {
  breakable: RWBreakable;
  /** Set once the prop has been smashed — skipped by the nearest-prop search. */
  broken: boolean;
  /** Stable instance key (`model|cmX|cmY|cmZ`) — pairs the render prop with its static collider. */
  key: string;
  /** Every part-mesh of the prop's model group (all collapsed to zero scale on break). */
  meshes: InstancedMesh[];
  modelName: string;
  /** Placement world position (GTA Z-up) — for the nearest-prop search + collider match. */
  position: readonly [number, number, number];
  /** Instance slot shared across the group's part InstancedMeshes. */
  slot: number;
  textures?: Map<string, Texture>;
  /** Placement world transform (GTA Z-up) — bakes the shatter mesh into world space. */
  transform: Matrix4;
}

/** Optional break parameters: a ground plane for the shards + an impact velocity seed. */
export interface BreakOptions {
  /** Ground height (GTA Z) the shards rest on; defaults to the prop's placement Z. */
  groundZ?: number;
  /** Impact velocity (world Z-up, m/s) flinging the shards away from the hit. */
  impact?: [number, number, number];
  /** Deterministic RNG seed (defaults to the placement-derived seed in {@link spawnDebris}). */
  seed?: number;
}

const HIDDEN = new Matrix4().makeScale(0, 0, 0);

const instances: BreakableInstance[] = [];

/**
 * Synthesize a shatter mesh from a model's **render** geometry (plan 045 fallback): props whose
 * object.dat collision-damage effect is "smash" but that carry no RW Breakable atomic (cardboard
 * boxes, bin bags, some fences) shatter their visible mesh instead. Maps the geometry's positions /
 * UVs / prelit colours / triangles + per-triangle material straight across; ambient is white (the
 * prelit colours already carry the shading), texture names lowercased to match the TXD dictionary.
 */
export function breakableFromGeometry(geometry: RWGeometry): RWBreakable {
  const vertexCount = geometry.positions.length / 3;
  const triangles = new Uint16Array(geometry.triangles.length * 3);
  const triangleMaterials = new Uint16Array(geometry.triangles.length);
  geometry.triangles.forEach((triangle, i) => {
    triangles[i * 3] = triangle.a;
    triangles[i * 3 + 1] = triangle.b;
    triangles[i * 3 + 2] = triangle.c;
    triangleMaterials[i] = triangle.materialIndex;
  });

  return {
    colours: geometry.prelitColors ?? new Uint8Array(vertexCount * 4).fill(255),
    materials: geometry.materials.map(
      (material): RWBreakableMaterial => ({
        ambient: [1, 1, 1],
        mask: (material.texture?.maskName ?? '').toLowerCase(),
        texture: (material.texture?.name ?? '').toLowerCase(),
      }),
    ),
    positions: geometry.positions,
    triangleMaterials,
    triangles,
    uvs: geometry.uvLayers[0] ?? new Float32Array(vertexCount * 2),
  };
}

/** Stable key for a placement (cm precision) — shared by the render prop and its collider tag. */
export function breakableInstanceKey(modelName: string, position: readonly [number, number, number]): string {
  const cm = (value: number): number => Math.round(value * 100);

  return `${modelName.toLowerCase()}|${cm(position[0])}|${cm(position[1])}|${cm(position[2])}`;
}

/**
 * Smash a registered prop: build its debris under `parent` (streaming root / Z-up), collapse its
 * InstancedMesh slots and mark it broken. No-op (returns false) if it is already broken or its
 * cell has streamed out (meshes detached). The caller drops the matching collider via {@link key}.
 */
export function breakBreakable(entry: BreakableInstance, parent: Object3D, options: BreakOptions = {}): boolean {
  if (entry.broken || !entry.meshes[0]?.parent) {
    return false;
  }
  // MVP: no ground probe — pass groundZ through (undefined ⇒ shards sink; see DebrisImpact.groundZ).
  spawnDebris(
    parent,
    entry.breakable,
    entry.transform,
    { groundZ: options.groundZ, impact: options.impact, seed: options.seed },
    entry.textures,
  );
  for (const mesh of entry.meshes) {
    mesh.setMatrixAt(entry.slot, HIDDEN);
    mesh.instanceMatrix.needsUpdate = true;
  }
  entry.broken = true;
  // Drop it from the registry so the nearest-prop scan stays cheap (a cell rebuild re-registers it).
  const index = instances.indexOf(entry);
  if (index >= 0) {
    instances.splice(index, 1);
  }

  return true;
}

/** The RW Breakable shatter mesh of a model, or undefined when it isn't breakable / not in the archive. */
export function getBreakable(archive: ImgArchive, modelName: string): RWBreakable | undefined {
  try {
    return getClump(archive, modelName).geometries.find((geometry) => geometry.breakable)?.breakable;
  } catch {
    return undefined; // model not in the archive — not breakable
  }
}

/** A registered, un-broken prop by its instance key (resolving a contact-force impact to the prop). */
export function getBreakableByKey(key: string): BreakableInstance | undefined {
  return instances.find((entry) => entry.key === key && !entry.broken);
}

/**
 * The nearest un-broken, still-streamed breakable to a Z-up world point — within `maxDistance` in
 * the ground plane (XY) and `maxVertical` in Z. The match is planar so a small radius isn't eaten by
 * the Z gap between a car's chassis centre and a prop's base; `maxVertical` keeps it from matching a
 * prop a floor above/below.
 */
export function nearestBreakable(
  point: readonly [number, number, number],
  maxDistance: number,
  maxVertical = Infinity,
): BreakableInstance | undefined {
  let best: BreakableInstance | undefined;
  let bestSq = maxDistance * maxDistance;
  for (const entry of instances) {
    if (entry.broken || !entry.meshes[0]?.parent || Math.abs(entry.position[2] - point[2]) > maxVertical) {
      continue;
    }
    const dx = entry.position[0] - point[0];
    const dy = entry.position[1] - point[1];
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= bestSq) {
      bestSq = distanceSq;
      best = entry;
    }
  }

  return best;
}

/** Register a placed breakable prop (replacing any stale entry with the same key — cell rebuilds). */
export function registerBreakable(entry: Omit<BreakableInstance, 'broken'>): void {
  const existing = instances.findIndex((other) => other.key === entry.key);
  if (existing >= 0) {
    instances.splice(existing, 1);
  }
  instances.push({ ...entry, broken: false });
}

/** Test hook: drop every registered prop (the registry is module-level shared state). */
export function resetBreakables(): void {
  instances.length = 0;
}
