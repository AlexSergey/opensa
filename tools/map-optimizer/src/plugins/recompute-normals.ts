import type { MapPlugin } from '../core/asset';
import type { Triangle } from '../core/ir';

/**
 * Recompute per-vertex normals: angle-weighted averaging over **position-welded** faces, limited by a
 * **crease angle** so smooth surfaces smooth (seam splits average away) while hard edges stay hard (the other
 * side's faces are excluded). Topology-preserving — only the normal array is rewritten — so it rides the
 * serializer's in-place patch. See plan 002.
 */

const DEFAULT_CREASE_DEG = 45;
const DEGENERATE_EPS = 1e-12;

export interface RecomputeNormalsOptions {
  /** Also compute + attach normals to meshes that have none (re-encoder adds the block). Default false. */
  addMissing?: boolean;
  /** Edges sharper than this (degrees) are kept hard (faces beyond it don't average in). Default 45. */
  creaseAngleDeg?: number;
}

/** A face's unit normal + the corner angle at one of its vertices (the angle-weight for that vertex). */
interface Contribution {
  angle: number;
  normal: Vec3;
}

type Vec3 = [number, number, number];

/** The plugin: recompute normals for every mesh that has a normal attribute; mark the asset dirty. */
export function createRecomputeNormals(options: RecomputeNormalsOptions = {}): MapPlugin {
  return {
    name: 'recompute-normals',
    transform(asset, context): void {
      let changed = 0;
      for (const mesh of asset.ir.meshes) {
        if (!mesh.normals && !options.addMissing) {
          continue; // normal-less mesh, and not asked to add one
        }
        const existing = mesh.normals ?? new Float32Array(mesh.positions.length);
        mesh.normals = recomputeNormals(mesh.positions, mesh.triangles, existing, options);
        changed += 1;
      }
      if (changed > 0) {
        asset.dirty = true;
        context.log(asset, 'recompute-normals', `recomputed ${changed} mesh normal set(s)`);
      }
    },
  };
}

/**
 * Pure normal recompute. `existing` is the current normal array, returned (per vertex) as the fallback for
 * vertices no usable face references. Returns a fresh `Float32Array` (same length as `positions`).
 */
export function recomputeNormals(
  positions: Float32Array,
  triangles: readonly Triangle[],
  existing: Float32Array,
  options: RecomputeNormalsOptions = {},
): Float32Array {
  const cosCrease = Math.cos(((options.creaseAngleDeg ?? DEFAULT_CREASE_DEG) * Math.PI) / 180);
  const vertexCount = positions.length / 3;
  const byPosition = new Map<string, Contribution[]>();
  const reference: Vec3[] = Array.from({ length: vertexCount }, () => [0, 0, 0]);

  for (const triangle of triangles) {
    const a = vertexAt(positions, triangle.a);
    const b = vertexAt(positions, triangle.b);
    const c = vertexAt(positions, triangle.c);
    const raw = cross(sub(b, a), sub(c, a));
    const area = length(raw);
    if (area < DEGENERATE_EPS) {
      continue; // degenerate / zero-area face — no contribution
    }
    const normal: Vec3 = [raw[0] / area, raw[1] / area, raw[2] / area];
    const corners: [number, Vec3, Vec3][] = [
      [triangle.a, sub(b, a), sub(c, a)],
      [triangle.b, sub(a, b), sub(c, b)],
      [triangle.c, sub(a, c), sub(b, c)],
    ];
    for (const [index, edge1, edge2] of corners) {
      const weight = cornerAngle(edge1, edge2);
      contributionsFor(byPosition, positionKey(positions, index)).push({ angle: weight, normal });
      addScaled(reference[index], normal, weight);
    }
  }

  const out = new Float32Array(positions.length);
  for (let v = 0; v < vertexCount; v += 1) {
    out.set(vertexNormal(v, positions, byPosition, reference[v], existing, cosCrease), v * 3);
  }

  return out;
}

function addScaled(target: Vec3, source: Vec3, scale: number): void {
  target[0] += source[0] * scale;
  target[1] += source[1] * scale;
  target[2] += source[2] * scale;
}

function contributionsFor(map: Map<string, Contribution[]>, key: string): Contribution[] {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }

  return list;
}

/** Interior angle of a triangle corner, between its two edge vectors (the angle-weight). */
function cornerAngle(edge1: Vec3, edge2: Vec3): number {
  const denominator = length(edge1) * length(edge2);
  if (denominator < DEGENERATE_EPS) {
    return 0;
  }

  return Math.acos(Math.min(1, Math.max(-1, dot(edge1, edge2) / denominator)));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The unit normal of the incident face with the largest corner angle (the vertex's dominant surface). */
function dominantNormal(contributions: readonly Contribution[]): null | Vec3 {
  let best: Contribution | null = null;
  for (const contribution of contributions) {
    if (!best || contribution.angle > best.angle) {
      best = contribution;
    }
  }

  return best ? best.normal : null;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): null | Vec3 {
  const len = length(v);

  return len < DEGENERATE_EPS ? null : [v[0] / len, v[1] / len, v[2] / len];
}

/** Exact-position key — exporter-duplicated seam/edge vertices share identical position floats. */
function positionKey(positions: Float32Array, index: number): string {
  return `${positions[index * 3]},${positions[index * 3 + 1]},${positions[index * 3 + 2]}`;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vertexAt(positions: Float32Array, index: number): Vec3 {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

/** One vertex's recomputed normal: angle-weighted sum of co-located faces within the crease angle. */
function vertexNormal(
  v: number,
  positions: Float32Array,
  byPosition: Map<string, Contribution[]>,
  reference: Vec3,
  existing: Float32Array,
  cosCrease: number,
): Vec3 {
  const contributions = byPosition.get(positionKey(positions, v)) ?? [];
  const ref = normalize(reference);
  if (ref) {
    const accumulator: Vec3 = [0, 0, 0];
    for (const contribution of contributions) {
      if (dot(contribution.normal, ref) >= cosCrease) {
        addScaled(accumulator, contribution.normal, contribution.angle);
      }
    }
    const crease = normalize(accumulator);
    if (crease) {
      return crease;
    }
  }

  // Degenerate reference — e.g. a vertex shared by opposite-winding faces, where the angle-weighted sum
  // cancels to zero. Fall back to the dominant incident face normal (a real surface direction) rather than a
  // zero normal, which the renderer would repair into a stray sliver. See plan 002 / the addMissing path.
  return dominantNormal(contributions) ?? [existing[v * 3], existing[v * 3 + 1], existing[v * 3 + 2]];
}
