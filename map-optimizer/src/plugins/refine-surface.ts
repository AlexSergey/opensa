import type { MapPlugin } from '../core/asset';
import type { SubMesh, Triangle } from '../core/ir';

/**
 * Adaptive surface refinement (plan 014, Phase 1.1): round coarsely-tessellated **curved** geometry (terrain
 * slopes/crests) by splitting **gently-curved interior edges** and placing the new midpoints on a **PN-triangle**
 * (curved point-normal) patch, so the surface bulges toward its own smooth normal field. Flat edges and hard
 * **creases** are left straight, and **boundary edges are never split** — so tile borders stay put and there are
 * no cracks within or between tiles (the cross-tile seam work is Phase 2).
 *
 * Two things make the smoothing actually land:
 * - **Crease-aware normals.** SA prelit geometry usually ships without normals, so the PN normal field is derived
 *   here — but per *smoothing region* (faces flood-filled across non-crease edges, union-find), not a blanket
 *   average. So a vertex where gentle terrain meets a cliff gets a normal from the terrain side, and the patch
 *   hugs the real surface instead of being pulled flat by the cliff.
 * - **Multi-level depth.** Each level re-fits and re-splits the now-finer mesh, so a huge curved facet keeps
 *   subdividing until its triangles fall below the size/angle target; flat regions stop after one look. Bounded
 *   by `maxLevels` and a per-mesh split budget.
 *
 * Derived normals are not written back; only positions / UVs / prelit / night / triangles change. Rides the
 * count-changing serializer (`rebuildGeometry`).
 */

type Vec3 = [number, number, number];

// Sweet spot from the cuntwland sweep: smooth-edge dihedral p95 plateaus ~27° (from ~31°) at these settings;
// more levels / a smaller area target only inflate triangle count for no further smoothing. ~4× triangles.
const DEFAULTS = {
  areaThreshold: 8,
  creaseDegrees: 40,
  flatDegrees: 8,
  maxLevels: 2,
  maxSplits: 60_000,
  weldEpsilon: 0.001,
};

export interface RefineSurfaceOptions {
  /** Only split edges where the larger adjacent triangle exceeds this area (world units²). */
  areaThreshold?: number;
  /** Dihedral above this (degrees) is a hard crease — kept sharp, and bounds smoothing regions. */
  creaseDegrees?: number;
  /** Dihedral below this (degrees) is flat — skipped. */
  flatDegrees?: number;
  /** Max refinement passes (adaptive depth). */
  maxLevels?: number;
  /** Budget: cap the total edges split per mesh across all levels (highest curvature × area first). */
  maxSplits?: number;
  /** Position-weld grid (world units) so seam-split vertices share edges/normals. */
  weldEpsilon?: number;
}

type Config = typeof DEFAULTS;

interface Edge {
  tris: number[];
  u: number;
  v: number;
}

interface Faces {
  area: Float64Array;
  normal: Float64Array;
}

type Geometry = Pick<SubMesh, 'nightColors' | 'normals' | 'positions' | 'prelitColors' | 'triangles' | 'uvs'>;

interface Welded {
  canonId: Int32Array;
  canonPos: number[];
  count: number;
}

export function createRefineSurface(options: RefineSurfaceOptions = {}): MapPlugin {
  return {
    name: 'refine-surface',
    transform(asset, context): void {
      let meshes = 0;
      let added = 0;
      for (const mesh of asset.ir.meshes) {
        const before = mesh.triangles.length;
        const refined = refineSubMesh(mesh, options);
        if (!refined) {
          continue;
        }
        Object.assign(mesh, refined);
        meshes += 1;
        added += refined.triangles.length - before;
      }
      if (meshes > 0) {
        asset.dirty = true;
        context.log(asset, 'refine-surface', `refined ${meshes} mesh(es), +${added} triangles`);
      }
    },
  };
}

/** Refine one mesh to convergence (multi-level), or `null` when there's nothing to refine. */
export function refineSubMesh(mesh: SubMesh, options: RefineSurfaceOptions = {}): Geometry | null {
  const config = { ...DEFAULTS, ...options };
  let geometry: Geometry = {
    nightColors: mesh.nightColors,
    normals: mesh.normals,
    positions: mesh.positions,
    prelitColors: mesh.prelitColors,
    triangles: [...mesh.triangles],
    uvs: mesh.uvs,
  };

  let budget = config.maxSplits;
  let changed = false;
  for (let level = 0; level < config.maxLevels && budget > 0; level += 1) {
    const pass = refineOnce(geometry, { ...config, maxSplits: budget });
    if (!pass) {
      break;
    }
    geometry = pass.geometry;
    budget -= pass.splits;
    changed = true;
  }

  return changed ? geometry : null;
}

/** Union-find the faces around one vertex (joined list = smooth edges), then write each face its region normal. */
function assignRegionNormals(
  out: Map<string, Vec3>,
  vertex: number,
  faceList: number[],
  joined: [number, number][],
  faces: Faces,
): void {
  const local = new Map<number, number>();
  faceList.forEach((face, i) => local.set(face, i));
  const parent = faceList.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }

    return i;
  };
  for (const [f0, f1] of joined) {
    const a = local.get(f0);
    const b = local.get(f1);
    if (a !== undefined && b !== undefined) {
      parent[find(a)] = find(b);
    }
  }

  const accum = new Map<number, Vec3>();
  faceList.forEach((face, i) => {
    const root = find(i);
    const sum = accum.get(root) ?? [0, 0, 0];
    sum[0] += faces.normal[face * 3] * faces.area[face];
    sum[1] += faces.normal[face * 3 + 1] * faces.area[face];
    sum[2] += faces.normal[face * 3 + 2] * faces.area[face];
    accum.set(root, sum);
  });
  faceList.forEach((face, i) => {
    out.set(`${vertex}|${face}`, normalize(accum.get(find(i))!));
  });
}

function buildEdges(triangles: Geometry['triangles'], canonId: Int32Array): Map<string, Edge> {
  const edges = new Map<string, Edge>();
  triangles.forEach((triangle, t) => {
    const corners = [triangle.a, triangle.b, triangle.c];
    for (let i = 0; i < 3; i += 1) {
      const u = canonId[corners[i]];
      const v = canonId[corners[(i + 1) % 3]];
      const key = edgeKey(u, v);
      const edge = edges.get(key);
      if (edge) {
        edge.tris.push(t);
      } else {
        edges.set(key, { tris: [t], u: Math.min(u, v), v: Math.max(u, v) });
      }
    }
  });

  return edges;
}

function canonAt(canonPos: number[], id: number): Vec3 {
  return [canonPos[id * 3], canonPos[id * 3 + 1], canonPos[id * 3 + 2]];
}

/** Pick which interior edges to split (gentle, coarse, not crease/boundary), under the budget, and their
 *  PN-displaced midpoint positions. */
function chooseSplits(
  edges: Map<string, Edge>,
  faces: Faces,
  welded: Welded,
  normals: Map<string, Vec3>,
  config: Config,
): Map<string, Vec3> {
  const candidates: { key: string; score: number }[] = [];
  for (const [key, edge] of edges) {
    if (edge.tris.length !== 2) {
      continue; // boundary or non-manifold — locked
    }
    const [t0, t1] = edge.tris;
    if (faces.area[t0] < 1e-9 || faces.area[t1] < 1e-9) {
      continue;
    }
    const maxArea = Math.max(faces.area[t0], faces.area[t1]);
    if (maxArea <= config.areaThreshold) {
      continue; // already finely tessellated
    }
    const degrees = dihedral(faces.normal, t0, t1);
    if (degrees < config.flatDegrees || degrees > config.creaseDegrees) {
      continue; // flat or hard crease
    }
    candidates.push({ key, score: degrees * maxArea });
  }
  candidates.sort((a, b) => b.score - a.score);

  const splits = new Map<string, Vec3>();
  for (const { key } of candidates.slice(0, config.maxSplits)) {
    const edge = edges.get(key)!;
    const face = edge.tris[0]; // smooth edge → both faces share this region at u and v
    splits.set(
      key,
      pnMidpoint(
        canonAt(welded.canonPos, edge.u),
        canonAt(welded.canonPos, edge.v),
        normals.get(`${edge.u}|${face}`)!,
        normals.get(`${edge.v}|${face}`)!,
      ),
    );
  }

  return splits;
}

/**
 * Per-(vertex, face) smooth normals: faces around a welded vertex are flood-filled across **non-crease** edges
 * into smoothing regions; each region's normal is its area-weighted average. So normals never blend across a
 * crease. Returned keyed by `${vertex}|${face}`.
 */
function creaseAwareNormals(
  triangles: Geometry['triangles'],
  faces: Faces,
  welded: Welded,
  edges: Map<string, Edge>,
  creaseDegrees: number,
): Map<string, Vec3> {
  const incident = new Map<number, number[]>();
  triangles.forEach((triangle, t) => {
    for (const vertex of [welded.canonId[triangle.a], welded.canonId[triangle.b], welded.canonId[triangle.c]]) {
      const list = incident.get(vertex);
      if (list) {
        list.push(t);
      } else {
        incident.set(vertex, [t]);
      }
    }
  });

  const merges = new Map<number, [number, number][]>(); // vertex → face pairs joined by a smooth edge
  for (const edge of edges.values()) {
    if (edge.tris.length !== 2) {
      continue;
    }
    const [f0, f1] = edge.tris;
    if (faces.area[f0] < 1e-9 || faces.area[f1] < 1e-9 || dihedral(faces.normal, f0, f1) > creaseDegrees) {
      continue; // boundary/degenerate/crease — don't merge regions across it
    }
    for (const vertex of [edge.u, edge.v]) {
      const list = merges.get(vertex);
      if (list) {
        list.push([f0, f1]);
      } else {
        merges.set(vertex, [[f0, f1]]);
      }
    }
  }

  const normals = new Map<string, Vec3>();
  for (const [vertex, faceList] of incident) {
    assignRegionNormals(normals, vertex, faceList, merges.get(vertex) ?? [], faces);
  }

  return normals;
}

function crossProduct(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dihedral(normals: Float64Array, t0: number, t1: number): number {
  const cos = dot(normalRow(normals, t0), normalRow(normals, t1));

  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function edgeKey(u: number, v: number): string {
  return u < v ? `${u},${v}` : `${v},${u}`;
}

function emitOneSplit(push: (a: number, b: number, c: number) => void, corners: number[], mids: number[]): void {
  const s = mids[0] >= 0 ? 0 : mids[1] >= 0 ? 1 : 2;
  const [c, m] = rotate(corners, mids, s);
  push(c[0], m[0], c[2]);
  push(m[0], c[1], c[2]);
}

/** Emit a triangle's conforming sub-triangles for however many of its 3 edges are split. */
function emitTriangle(
  out: Triangle[],
  triangle: Triangle,
  canonId: Int32Array,
  splits: Map<string, Vec3>,
  midpoint: (p: number, q: number, key: string) => number,
): void {
  const corners = [triangle.a, triangle.b, triangle.c];
  const keys = [0, 1, 2].map((i) => edgeKey(canonId[corners[i]], canonId[corners[(i + 1) % 3]]));
  const mids = keys.map((key, i) => (splits.has(key) ? midpoint(corners[i], corners[(i + 1) % 3], key) : -1));
  const material = triangle.material;
  const push = (a: number, b: number, c: number): void => {
    out.push({ a, b, c, material });
  };

  const count = mids.filter((m) => m >= 0).length;
  if (count === 0) {
    push(corners[0], corners[1], corners[2]);
  } else if (count === 3) {
    push(corners[0], mids[0], mids[2]);
    push(mids[0], corners[1], mids[1]);
    push(mids[2], mids[1], corners[2]);
    push(mids[0], mids[1], mids[2]);
  } else if (count === 1) {
    emitOneSplit(push, corners, mids);
  } else {
    emitTwoSplit(push, corners, mids);
  }
}

function emitTwoSplit(push: (a: number, b: number, c: number) => void, corners: number[], mids: number[]): void {
  const open = mids[0] < 0 ? 0 : mids[1] < 0 ? 1 : 2; // the un-split edge
  const [c, m] = rotate(corners, mids, (open + 1) % 3);
  push(m[0], c[1], m[1]);
  push(c[0], m[0], m[1]);
  push(c[0], m[1], c[2]);
}

function faceData(positions: Float32Array, triangles: Geometry['triangles']): Faces {
  const normal = new Float64Array(triangles.length * 3);
  const area = new Float64Array(triangles.length);
  triangles.forEach((triangle, t) => {
    const a = vertexAt(positions, triangle.a);
    const ab = sub(vertexAt(positions, triangle.b), a);
    const ac = sub(vertexAt(positions, triangle.c), a);
    const cross = crossProduct(ab, ac);
    const length = magnitude(cross);
    area[t] = length / 2;
    if (length > 1e-9) {
      normal[t * 3] = cross[0] / length;
      normal[t * 3 + 1] = cross[1] / length;
      normal[t * 3 + 2] = cross[2] / length;
    }
  });

  return { area, normal };
}

function lerp(out: null | number[], source: Float32Array | null, p: number, q: number, size: number): null | number[] {
  if (!out || !source) {
    return null;
  }
  const result: number[] = [];
  for (let i = 0; i < size; i += 1) {
    result.push((source[p * size + i] + source[q * size + i]) / 2);
  }

  return result;
}

function lerpBytes(out: null | number[], source: null | Uint8Array, p: number, q: number): null | number[] {
  if (!out || !source) {
    return null;
  }

  return [0, 1, 2, 3].map((i) => Math.round((source[p * 4 + i] + source[q * 4 + i]) / 2));
}

function lerpNormal(out: null | number[], source: Float32Array | null, p: number, q: number): null | number[] {
  if (!out || !source) {
    return null;
  }

  return normalize([
    source[p * 3] + source[q * 3],
    source[p * 3 + 1] + source[q * 3 + 1],
    source[p * 3 + 2] + source[q * 3 + 2],
  ]);
}

function magnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const length = magnitude(v) || 1;

  return [v[0] / length, v[1] / length, v[2] / length];
}

function normalRow(normals: Float64Array, t: number): Vec3 {
  return [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]];
}

/** PN-triangle edge midpoint: cubic Bézier of the edge at t=0.5, displaced by the endpoint normals. */
function pnMidpoint(pi: Vec3, pj: Vec3, ni: Vec3, nj: Vec3): Vec3 {
  const wij = dot(sub(pj, pi), ni);
  const wji = dot(sub(pi, pj), nj);
  const b1: Vec3 = [
    (2 * pi[0] + pj[0] - wij * ni[0]) / 3,
    (2 * pi[1] + pj[1] - wij * ni[1]) / 3,
    (2 * pi[2] + pj[2] - wij * ni[2]) / 3,
  ];
  const b2: Vec3 = [
    (2 * pj[0] + pi[0] - wji * nj[0]) / 3,
    (2 * pj[1] + pi[1] - wji * nj[1]) / 3,
    (2 * pj[2] + pi[2] - wji * nj[2]) / 3,
  ];

  return [
    0.125 * pi[0] + 0.375 * b1[0] + 0.375 * b2[0] + 0.125 * pj[0],
    0.125 * pi[1] + 0.375 * b1[1] + 0.375 * b2[1] + 0.125 * pj[1],
    0.125 * pi[2] + 0.375 * b1[2] + 0.375 * b2[2] + 0.125 * pj[2],
  ];
}

function pushChannel(out: null | number[], values: null | number[]): void {
  if (out && values) {
    out.push(...values);
  }
}

function rebuild(geometry: Geometry, canonId: Int32Array, splits: Map<string, Vec3>): Geometry {
  const out = {
    nightColors: geometry.nightColors ? [...geometry.nightColors] : null,
    normals: geometry.normals ? [...geometry.normals] : null,
    positions: [...geometry.positions],
    prelitColors: geometry.prelitColors ? [...geometry.prelitColors] : null,
    triangles: [] as Triangle[],
    uvs: geometry.uvs ? [...geometry.uvs] : null,
  };
  const midCache = new Map<string, number>();

  const midpoint = (p: number, q: number, key: string): number => {
    const uv = lerp(out.uvs, geometry.uvs, p, q, 2);
    const prelit = lerpBytes(out.prelitColors, geometry.prelitColors, p, q);
    const night = lerpBytes(out.nightColors, geometry.nightColors, p, q);
    const normal = lerpNormal(out.normals, geometry.normals, p, q);
    const part = (values: null | number[]): string => (values ? values.join(',') : '');
    const cacheKey = `${key}|${part(uv)}|${part(prelit)}|${part(night)}|${part(normal)}`;
    const cached = midCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const index = out.positions.length / 3;
    const position = splits.get(key)!;
    out.positions.push(position[0], position[1], position[2]);
    pushChannel(out.uvs, uv);
    pushChannel(out.prelitColors, prelit);
    pushChannel(out.nightColors, night);
    pushChannel(out.normals, normal);
    midCache.set(cacheKey, index);

    return index;
  };

  for (const triangle of geometry.triangles) {
    emitTriangle(out.triangles, triangle, canonId, splits, midpoint);
  }

  return {
    nightColors: out.nightColors ? Uint8Array.from(out.nightColors) : null,
    normals: out.normals ? Float32Array.from(out.normals) : null,
    positions: Float32Array.from(out.positions),
    prelitColors: out.prelitColors ? Uint8Array.from(out.prelitColors) : null,
    triangles: out.triangles,
    uvs: out.uvs ? Float32Array.from(out.uvs) : null,
  };
}

function refineOnce(geometry: Geometry, config: Config): null | { geometry: Geometry; splits: number } {
  if (geometry.triangles.length === 0) {
    return null;
  }
  const welded = weld(geometry.positions, config.weldEpsilon);
  const faces = faceData(geometry.positions, geometry.triangles);
  const edges = buildEdges(geometry.triangles, welded.canonId);
  const normals = creaseAwareNormals(geometry.triangles, faces, welded, edges, config.creaseDegrees);
  const splits = chooseSplits(edges, faces, welded, normals, config);
  if (splits.size === 0) {
    return null;
  }

  return { geometry: rebuild(geometry, welded.canonId, splits), splits: splits.size };
}

/** Rotate corners + their edge midpoints left by `by` (keeps winding and edge↔midpoint alignment). */
function rotate(corners: number[], mids: number[], by: number): [number[], number[]] {
  return [
    [corners[by], corners[(by + 1) % 3], corners[(by + 2) % 3]],
    [mids[by], mids[(by + 1) % 3], mids[(by + 2) % 3]],
  ];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vertexAt(positions: Float32Array, i: number): Vec3 {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

function weld(positions: Float32Array, epsilon: number): Welded {
  const canon = new Map<string, number>();
  const canonId = new Int32Array(positions.length / 3);
  const canonPos: number[] = [];
  for (let i = 0; i < canonId.length; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${Math.round(x / epsilon)},${Math.round(y / epsilon)},${Math.round(z / epsilon)}`;
    let id = canon.get(key);
    if (id === undefined) {
      id = canon.size;
      canon.set(key, id);
      canonPos.push(x, y, z);
    }
    canonId[i] = id;
  }

  return { canonId, canonPos, count: canon.size };
}
