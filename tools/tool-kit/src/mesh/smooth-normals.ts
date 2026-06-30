/**
 * Rebuild per-vertex normals from **smooth groups** (map-optimizer plan 015), decoupled from any mesh type so
 * both map-optimizer (SubMesh) and opensa-lod-generator (merged cell mesh) can drive it. Operates on raw
 * `positions` + flat triangle **index triples** and returns new normals, the remapped indices, and the list of
 * appended (split) vertices — each caller then duplicates *its own* attributes (uv / prelit / colour) for the
 * splits via `splitSources`.
 *
 * Algorithm: (1) weld vertices by position; face normals + areas. (2) flood-fill faces into smooth groups across
 * edges whose dihedral ≤ the crease angle (hard edges / boundaries / double faces bound groups). (3) give each
 * vertex the area-weighted average of **one** group, **splitting** a vertex shared by several groups into one
 * copy per group. Original vertices stay in place (same indices) — only extra group-copies are appended — so a
 * mesh needing no split comes back with identical vertex count + indices (lets a count-aware serializer take its
 * safe attribute-overlay path). See plan 015 for the shatter-bug history this ordering avoids.
 */

type Vec3 = [number, number, number];

const DEFAULTS = { creaseAngleDeg: 45, weldEpsilon: 0.001 };

export interface SmoothNormalsOptions {
  /** Edges sharper than this (degrees) bound smooth groups (faces across them don't average together). */
  creaseAngleDeg?: number;
  /** Position-weld grid (world units) so seam-split vertices share adjacency. */
  weldEpsilon?: number;
}

export interface SmoothNormalsResult {
  /** Remapped triangle vertex indices, flattened (triangleCount × 3), same face order as the input. */
  indices: Uint32Array;
  /** New per-vertex normals, flattened ((originalVertexCount + splitSources.length) × 3). */
  normals: Float32Array;
  /** For each appended vertex (index ≥ originalVertexCount), the original vertex index it copies. */
  splitSources: number[];
}

interface Faces {
  area: Float64Array;
  normal: Float64Array;
}

/**
 * Re-expand a per-vertex attribute for a {@link SmoothNormalsResult}: the original buffer followed by a copy of
 * each split vertex's `size`-tuple (in `splitSources` order). Callers use this to grow positions / UVs / colours
 * to match the rebuilt `normals` + `indices`.
 */
export function appendSplitsF32(source: Float32Array, splitSources: readonly number[], size: number): Float32Array {
  const out = new Float32Array(source.length + splitSources.length * size);
  out.set(source, 0);
  splitSources.forEach((src, k) => {
    for (let i = 0; i < size; i += 1) {
      out[source.length + k * size + i] = source[src * size + i];
    }
  });

  return out;
}

/** {@link appendSplitsF32} for a byte attribute (prelit / night colours). */
export function appendSplitsU8(source: Uint8Array, splitSources: readonly number[], size: number): Uint8Array {
  const out = new Uint8Array(source.length + splitSources.length * size);
  out.set(source, 0);
  splitSources.forEach((src, k) => {
    for (let i = 0; i < size; i += 1) {
      out[source.length + k * size + i] = source[src * size + i];
    }
  });

  return out;
}

/**
 * Recompute normals from smooth groups, splitting at hard edges. `indices` is flat triples into `positions`;
 * returns `null` when there are no triangles.
 */
export function rebuildSmoothNormals(
  positions: Float32Array,
  indices: ArrayLike<number>,
  options: SmoothNormalsOptions = {},
): null | SmoothNormalsResult {
  const triangleCount = Math.floor(indices.length / 3);
  if (triangleCount === 0) {
    return null;
  }
  const cosCrease = Math.cos(((options.creaseAngleDeg ?? DEFAULTS.creaseAngleDeg) * Math.PI) / 180);

  const canonId = weld(positions, options.weldEpsilon ?? DEFAULTS.weldEpsilon);
  const faces = faceData(positions, indices, triangleCount);
  const groupOf = smoothGroups(indices, triangleCount, canonId, faces, cosCrease);
  const groupNormals = accumulateGroupNormals(indices, triangleCount, canonId, groupOf, faces);

  return emitSplitVertices(positions.length / 3, indices, triangleCount, canonId, groupOf, groupNormals);
}

/** Area-weighted normal per `(welded vertex, group)`, keyed `${canonVertex}|${group}`. */
function accumulateGroupNormals(
  indices: ArrayLike<number>,
  triangleCount: number,
  canonId: Int32Array,
  groupOf: Int32Array,
  faces: Faces,
): Map<string, Vec3> {
  const accum = new Map<string, Vec3>();
  for (let f = 0; f < triangleCount; f += 1) {
    const group = groupOf[f];
    for (let c = 0; c < 3; c += 1) {
      const key = `${canonId[indices[f * 3 + c]]}|${group}`;
      const sum = accum.get(key) ?? [0, 0, 0];
      sum[0] += faces.normal[f * 3] * faces.area[f];
      sum[1] += faces.normal[f * 3 + 1] * faces.area[f];
      sum[2] += faces.normal[f * 3 + 2] * faces.area[f];
      accum.set(key, sum);
    }
  }

  return accum;
}

function crossProduct(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Re-emit indices, keeping original vertices in place and appending one copy per extra smooth group. */
function emitSplitVertices(
  vertexCount: number,
  indices: ArrayLike<number>,
  triangleCount: number,
  canonId: Int32Array,
  groupOf: Int32Array,
  groupNormals: Map<string, Vec3>,
): SmoothNormalsResult {
  const normals = new Array<number>(vertexCount * 3).fill(0);
  const splitSources: number[] = [];
  const primaryGroup = new Int32Array(vertexCount).fill(-1);
  const appended = new Map<string, number>(); // `${originalVertex}|${group}` → appended index

  const normalFor = (original: number, group: number): Vec3 =>
    normalize(groupNormals.get(`${canonId[original]}|${group}`) ?? [0, 0, 1]);

  const resolve = (original: number, group: number): number => {
    if (primaryGroup[original] === -1) {
      primaryGroup[original] = group; // this group owns the original slot
      const [nx, ny, nz] = normalFor(original, group);
      normals[original * 3] = nx;
      normals[original * 3 + 1] = ny;
      normals[original * 3 + 2] = nz;

      return original;
    }
    if (primaryGroup[original] === group) {
      return original;
    }
    const key = `${original}|${group}`;
    const cached = appended.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const index = vertexCount + splitSources.length;
    appended.set(key, index);
    splitSources.push(original);
    normals.push(...normalFor(original, group));

    return index;
  };

  const out = new Uint32Array(triangleCount * 3);
  for (let f = 0; f < triangleCount; f += 1) {
    out[f * 3] = resolve(indices[f * 3], groupOf[f]);
    out[f * 3 + 1] = resolve(indices[f * 3 + 1], groupOf[f]);
    out[f * 3 + 2] = resolve(indices[f * 3 + 2], groupOf[f]);
  }

  return { indices: out, normals: Float32Array.from(normals), splitSources };
}

function faceData(positions: Float32Array, indices: ArrayLike<number>, triangleCount: number): Faces {
  const normal = new Float64Array(triangleCount * 3);
  const area = new Float64Array(triangleCount);
  for (let f = 0; f < triangleCount; f += 1) {
    const a = vertexAt(positions, indices[f * 3]);
    const cross = crossProduct(
      sub(vertexAt(positions, indices[f * 3 + 1]), a),
      sub(vertexAt(positions, indices[f * 3 + 2]), a),
    );
    const length = Math.hypot(cross[0], cross[1], cross[2]);
    area[f] = length / 2;
    if (length > 1e-9) {
      normal[f * 3] = cross[0] / length;
      normal[f * 3 + 1] = cross[1] / length;
      normal[f * 3 + 2] = cross[2] / length;
    }
  }

  return { area, normal };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);

  return length < 1e-9 ? [0, 0, 1] : [v[0] / length, v[1] / length, v[2] / length];
}

/** Union faces across smooth edges (dihedral ≤ crease); returns each face's group root. */
function smoothGroups(
  indices: ArrayLike<number>,
  triangleCount: number,
  canonId: Int32Array,
  faces: Faces,
  cosCrease: number,
): Int32Array {
  const parent = new Int32Array(triangleCount);
  for (let i = 0; i < parent.length; i += 1) {
    parent[i] = i;
  }
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }

    return i;
  };

  const edges = new Map<string, number[]>();
  for (let f = 0; f < triangleCount; f += 1) {
    const corners = [canonId[indices[f * 3]], canonId[indices[f * 3 + 1]], canonId[indices[f * 3 + 2]]];
    for (let i = 0; i < 3; i += 1) {
      const u = corners[i];
      const v = corners[(i + 1) % 3];
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      const list = edges.get(key);
      if (list) {
        list.push(f);
      } else {
        edges.set(key, [f]);
      }
    }
  }

  for (const incident of edges.values()) {
    if (incident.length !== 2) {
      continue; // boundary / non-manifold — a hard group boundary
    }
    const [a, b] = incident;
    if (faces.area[a] < 1e-9 || faces.area[b] < 1e-9) {
      continue;
    }
    const dot =
      faces.normal[a * 3] * faces.normal[b * 3] +
      faces.normal[a * 3 + 1] * faces.normal[b * 3 + 1] +
      faces.normal[a * 3 + 2] * faces.normal[b * 3 + 2];
    if (dot >= cosCrease) {
      parent[find(a)] = find(b); // smooth edge — same group
    }
  }

  const group = new Int32Array(triangleCount);
  for (let i = 0; i < group.length; i += 1) {
    group[i] = find(i);
  }

  return group;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vertexAt(positions: Float32Array, i: number): Vec3 {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

function weld(positions: Float32Array, epsilon: number): Int32Array {
  const canon = new Map<string, number>();
  const canonId = new Int32Array(positions.length / 3);
  for (let i = 0; i < canonId.length; i += 1) {
    const key = `${Math.round(positions[i * 3] / epsilon)},${Math.round(positions[i * 3 + 1] / epsilon)},${Math.round(positions[i * 3 + 2] / epsilon)}`;
    let id = canon.get(key);
    if (id === undefined) {
      id = canon.size;
      canon.set(key, id);
    }
    canonId[i] = id;
  }

  return canonId;
}
