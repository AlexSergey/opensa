import type { SubMesh } from '../core/ir';

/**
 * Curvature scan for the road/terrain-smoothing investigation (plan 014, Phase 0). Measures, per geometry, how
 * much surface is **flat** (skip — no refinement needed), **gently curved** (the refinement target: large
 * triangles that span real curvature), and **hard creases** (keep sharp — curbs, walls). All metrics are from
 * **dihedral angles** between adjacent faces and triangle **areas**, both invariant under a tile's rigid IPL
 * placement — so a single DFF is scanned in its own local space, no map assembly required (that's Phase 2, for
 * cross-tile seams).
 *
 * Adjacency is built by **welded position** (quantized), not vertex index, so the split vertices SA emits at
 * material/UV seams don't masquerade as mesh boundaries.
 */

export interface CurvatureMetrics {
  /** Interior-edge classification counts (by dihedral) + boundary edges. */
  edges: { boundary: number; crease: number; flat: number; gentle: number };
  /** Triangles bigger than `areaThreshold`. */
  largeTriangles: number;
  /** Surface area of the refine-candidate triangles. */
  refineArea: number;
  /** Large triangles that also touch a gently-curved edge — the Phase-1 refinement target. */
  refineCandidates: number;
  totalArea: number;
  triangles: number;
}

export interface CurvatureThresholds {
  /** A triangle bigger than this (world units²) is "large" (coarsely tessellated). */
  areaThreshold: number;
  /** Dihedral above this (degrees) is a hard crease — keep sharp, never round. */
  creaseDegrees: number;
  /** Dihedral below this (degrees) is flat — nothing to refine. */
  flatDegrees: number;
  /** Position-weld grid (world units) so seam-split vertices share edges. */
  weldEpsilon: number;
}

export const DEFAULT_THRESHOLDS: CurvatureThresholds = {
  areaThreshold: 4,
  creaseDegrees: 40,
  flatDegrees: 8,
  weldEpsilon: 0.001,
};

export function emptyMetrics(): CurvatureMetrics {
  return {
    edges: { boundary: 0, crease: 0, flat: 0, gentle: 0 },
    largeTriangles: 0,
    refineArea: 0,
    refineCandidates: 0,
    totalArea: 0,
    triangles: 0,
  };
}

export function mergeMetrics(a: CurvatureMetrics, b: CurvatureMetrics): CurvatureMetrics {
  return {
    edges: {
      boundary: a.edges.boundary + b.edges.boundary,
      crease: a.edges.crease + b.edges.crease,
      flat: a.edges.flat + b.edges.flat,
      gentle: a.edges.gentle + b.edges.gentle,
    },
    largeTriangles: a.largeTriangles + b.largeTriangles,
    refineArea: a.refineArea + b.refineArea,
    refineCandidates: a.refineCandidates + b.refineCandidates,
    totalArea: a.totalArea + b.totalArea,
    triangles: a.triangles + b.triangles,
  };
}

export function scanGeometry(
  positions: Float32Array,
  triangles: SubMesh['triangles'],
  thresholds: CurvatureThresholds = DEFAULT_THRESHOLDS,
): CurvatureMetrics {
  const metrics = emptyMetrics();
  const vertex = (i: number): [number, number, number] => [
    positions[i * 3],
    positions[i * 3 + 1],
    positions[i * 3 + 2],
  ];

  const normals: [number, number, number][] = [];
  const areas: number[] = [];
  const gentle: boolean[] = Array.from({ length: triangles.length }, () => false);
  const edges = new Map<string, number[]>(); // welded edge → incident triangle indices

  const canon = new Map<string, number>();
  const canonOf = (i: number): number => {
    const [x, y, z] = vertex(i);
    const e = thresholds.weldEpsilon;
    const key = `${Math.round(x / e)},${Math.round(y / e)},${Math.round(z / e)}`;
    let id = canon.get(key);
    if (id === undefined) {
      id = canon.size;
      canon.set(key, id);
    }

    return id;
  };

  triangles.forEach((triangle, index) => {
    const a = vertex(triangle.a);
    const ab = sub(vertex(triangle.b), a);
    const ac = sub(vertex(triangle.c), a);
    const cross = crossProduct(ab, ac);
    const length = magnitude(cross);
    areas.push(length / 2);
    normals.push(length > 1e-9 ? [cross[0] / length, cross[1] / length, cross[2] / length] : [0, 0, 0]);

    const [ca, cb, cc] = [canonOf(triangle.a), canonOf(triangle.b), canonOf(triangle.c)];
    for (const [u, v] of [
      [ca, cb],
      [cb, cc],
      [cc, ca],
    ]) {
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      const incident = edges.get(key);
      if (incident) {
        incident.push(index);
      } else {
        edges.set(key, [index]);
      }
    }
  });

  classifyEdges(edges, normals, areas, thresholds, metrics, gentle);

  triangles.forEach((_, index) => {
    const area = areas[index];
    metrics.totalArea += area;
    if (area <= thresholds.areaThreshold) {
      return;
    }
    metrics.largeTriangles += 1;
    if (gentle[index]) {
      metrics.refineCandidates += 1;
      metrics.refineArea += area;
    }
  });
  metrics.triangles = triangles.length;

  return metrics;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function classifyEdges(
  edges: Map<string, number[]>,
  normals: [number, number, number][],
  areas: number[],
  thresholds: CurvatureThresholds,
  metrics: CurvatureMetrics,
  gentle: boolean[],
): void {
  for (const incident of edges.values()) {
    if (incident.length === 1) {
      metrics.edges.boundary += 1;
      continue;
    }
    if (incident.length !== 2) {
      metrics.edges.crease += 1; // non-manifold — treat as a hard edge
      continue;
    }
    const [t0, t1] = incident;
    if (areas[t0] < 1e-9 || areas[t1] < 1e-9) {
      continue; // degenerate face — normal unreliable
    }
    const degrees = (Math.acos(clamp(dot(normals[t0], normals[t1]), -1, 1)) * 180) / Math.PI;
    if (degrees < thresholds.flatDegrees) {
      metrics.edges.flat += 1;
    } else if (degrees > thresholds.creaseDegrees) {
      metrics.edges.crease += 1;
    } else {
      metrics.edges.gentle += 1;
      gentle[t0] = true;
      gentle[t1] = true;
    }
  }
}

function crossProduct(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function magnitude(v: readonly number[]): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function sub(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
