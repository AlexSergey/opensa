/**
 * Seam-prelit weld — the pure Phase-1 core (plan 016). Given the **uniquely-placed** map models (each with its
 * world placement + per-geometry prelit) it finds **boundary vertices that coincide in world space across two
 * different models** and averages their prelit RGB, so the hard brightness seam on a shared tile edge closes.
 * Returns per-model overrides keyed by **local position** (not vertex index — the pipeline re-indexes/splits
 * vertices; position is invariant), consumed by `plugins/weld-seam-prelit.ts`.
 *
 * Pure + archive-free. Boundary detection, the world transform and the spatial grouping are shared with the gap
 * stitch (plan 017) via `boundary.ts`.
 */

import type { Placement, Vec3, WorldPoint } from './boundary';

import { boundaryVertices, connectedGroups, rotateByConjugate, transformToWorld, vertexNormals } from './boundary';

export type { Placement };
export { transformToWorld };

/** One prelit geometry of a model (a single DFF geometry that carries prelit). */
export interface SeamGeometry {
  /** Vertex positions in model-local space, flattened xyz. */
  positions: Float32Array;
  /** Per-vertex prelit RGBA, flattened (`4 × vertexCount`). */
  prelit: Uint8Array;
  /** Triangles as vertex-index triples into `positions`. */
  triangles: readonly { a: number; b: number; c: number }[];
}

/** A uniquely-placed model: its placement + the prelit geometries to weld. */
export interface SeamModel {
  geometries: readonly SeamGeometry[];
  name: string;
  placement: Placement;
}

export interface SeamWeldOptions {
  /** Include `lod*` models in the weld (consumed by the adapter's model selection). Default **false** — an HD tile
   *  and its far-LOD are never co-visible (streaming swaps them), so welding that pair is pointless / mildly
   *  harmful (plan 016 real-data finding). */
  includeLods?: boolean;
  /** Max luma spread (0–255) within a seam group; groups above are skipped (a level-normalisation "B" case). */
  maxLumaDelta?: number;
  /** Min cosine between two vertices' world normals to weld them (blocks an overpass edge fusing to the road
   *  below). Default cos 45°. Set ≤ −1 to disable the guard. */
  normalCosThreshold?: number;
  /** World-space coincidence tolerance (units). Vertices within this distance are candidates to weld. */
  weldEpsilon?: number;
}

export interface SeamWeldResult {
  overrides: Map<string, VertexOverride[]>;
  stats: SeamWeldStats;
}

export interface SeamWeldStats {
  /** Distinct models that received at least one override. */
  modelsTouched: number;
  /** Seam groups skipped because their luma spread exceeded `maxLumaDelta`. */
  skippedSpread: number;
  /** Seam groups (≥2 distinct models) that were welded. */
  welded: number;
}

/** A prelit override for one vertex: match by local position, overwrite RGB (alpha stays). */
export interface VertexOverride {
  pos: readonly [number, number, number];
  rgb: readonly [number, number, number];
}

const DEFAULTS = { maxLumaDelta: 128, normalCosThreshold: Math.cos(Math.PI / 4), weldEpsilon: 0.05 };

/** One boundary vertex of one placed model, resolved into world space (a weld candidate). */
interface SeamPoint extends WorldPoint {
  localPos: Vec3;
  model: string;
  rgb: Vec3;
}

/**
 * Compute per-model prelit overrides that close cross-model seams. Only boundary vertices participate, only
 * groups spanning ≥2 distinct models are welded, and RGB is the group mean (alpha is never touched — the
 * consumer copies it verbatim).
 */
export function computeSeamOverrides(models: readonly SeamModel[], options: SeamWeldOptions = {}): SeamWeldResult {
  const weldEpsilon = options.weldEpsilon ?? DEFAULTS.weldEpsilon;
  const normalCos = options.normalCosThreshold ?? DEFAULTS.normalCosThreshold;
  const maxLumaDelta = options.maxLumaDelta ?? DEFAULTS.maxLumaDelta;

  const points = collectBoundaryPoints(models);
  const overrides = new Map<string, VertexOverride[]>();
  const stats: SeamWeldStats = { modelsTouched: 0, skippedSpread: 0, welded: 0 };
  for (const members of connectedGroups(points, weldEpsilon, normalCos)) {
    if (!spansMultipleModels(points, members)) {
      continue; // a single model's own coincident boundary — nothing to reconcile
    }
    if (lumaSpread(points, members) > maxLumaDelta) {
      stats.skippedSpread += 1; // too different to average — a level-normalisation ("B") case
      continue;
    }
    const rgb = meanRgb(points, members);
    for (const index of members) {
      pushOverride(overrides, points[index].model, { pos: points[index].localPos, rgb });
    }
    stats.welded += 1;
  }
  stats.modelsTouched = overrides.size;

  return { overrides, stats };
}

/** Every boundary vertex of every model, resolved to world space (position + normal) with its prelit RGB. */
function collectBoundaryPoints(models: readonly SeamModel[]): SeamPoint[] {
  const points: SeamPoint[] = [];
  for (const model of models) {
    for (const geometry of model.geometries) {
      const vertexCount = geometry.positions.length / 3;
      if (geometry.prelit.length !== vertexCount * 4) {
        continue; // prelit count mismatch — can't trust it, skip this geometry
      }
      const normals = vertexNormals(geometry.positions, geometry.triangles);
      for (const v of boundaryVertices(geometry.triangles)) {
        const localPos: Vec3 = [
          geometry.positions[v * 3],
          geometry.positions[v * 3 + 1],
          geometry.positions[v * 3 + 2],
        ];
        const localNormal: Vec3 = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
        points.push({
          localPos,
          model: model.name,
          rgb: [geometry.prelit[v * 4], geometry.prelit[v * 4 + 1], geometry.prelit[v * 4 + 2]],
          world: transformToWorld(model.placement, localPos),
          worldNormal: rotateByConjugate(model.placement.rotation, localNormal),
        });
      }
    }
  }

  return points;
}

function lumaSpread(points: readonly SeamPoint[], members: readonly number[]): number {
  let min = 255;
  let max = 0;
  for (const index of members) {
    const [r, g, b] = points[index].rgb;
    const luma = (r + g + b) / 3;
    min = Math.min(min, luma);
    max = Math.max(max, luma);
  }

  return max - min;
}

function meanRgb(points: readonly SeamPoint[], members: readonly number[]): Vec3 {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const index of members) {
    r += points[index].rgb[0];
    g += points[index].rgb[1];
    b += points[index].rgb[2];
  }
  const n = members.length;

  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function pushOverride(overrides: Map<string, VertexOverride[]>, model: string, override: VertexOverride): void {
  const list = overrides.get(model);
  if (list) {
    list.push(override);
  } else {
    overrides.set(model, [override]);
  }
}

function spansMultipleModels(points: readonly SeamPoint[], members: readonly number[]): boolean {
  const first = points[members[0]].model;

  return members.some((index) => points[index].model !== first);
}
