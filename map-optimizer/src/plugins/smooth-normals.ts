import type { MapPlugin } from '../core/asset';
import type { SubMesh, Triangle } from '../core/ir';

/**
 * Rebuild per-vertex normals from **smooth groups** (plan 015): SA prelit world geometry ships with broken or
 * absent normals, so the engine falls back to a naive whole-mesh average — smearing walls into gradients,
 * cancelling to zero at double faces, and feeding SSAO garbage (dark edges). This recomputes them the way a
 * modelling package would:
 *
 * 1. Weld vertices by position; compute face normals + areas.
 * 2. Flood-fill faces into **smooth groups** across edges whose dihedral is ≤ the crease angle; hard edges
 *    (and boundaries / double faces) bound the groups.
 * 3. Give each vertex the area-weighted average of the faces of **one** group, **splitting** a vertex shared by
 *    several groups into one copy per group (each its own flat normal). UV/prelit/night are duplicated onto the
 *    splits, so seams are preserved.
 *
 * Result: flat walls stay flat, hard edges stay sharp, double faces get correct outward normals — no blended
 * gradients, no zero-cancel slivers. Vertex count grows at hard edges (rides the count-changing serializer).
 */

type Vec3 = [number, number, number];

const DEFAULTS = { creaseAngleDeg: 45, weldEpsilon: 0.001 };

export interface SmoothNormalsOptions {
  /** Edges sharper than this (degrees) bound smooth groups (faces across them don't average together). */
  creaseAngleDeg?: number;
  /** Position-weld grid (world units) so seam-split vertices share adjacency. */
  weldEpsilon?: number;
}

interface Faces {
  area: Float64Array;
  normal: Float64Array;
}

type Rebuilt = Pick<SubMesh, 'nightColors' | 'normals' | 'positions' | 'prelitColors' | 'triangles' | 'uvs'>;

export function createSmoothNormals(options: SmoothNormalsOptions = {}): MapPlugin {
  return {
    name: 'smooth-normals',
    transform(asset, context): void {
      let meshes = 0;
      let split = 0;
      for (const mesh of asset.ir.meshes) {
        const before = mesh.positions.length / 3;
        const rebuilt = rebuildSmoothNormals(mesh, options);
        if (!rebuilt) {
          continue;
        }
        Object.assign(mesh, rebuilt);
        meshes += 1;
        split += rebuilt.positions.length / 3 - before;
      }
      if (meshes > 0) {
        asset.dirty = true;
        context.log(asset, 'smooth-normals', `rebuilt ${meshes} mesh(es), +${split} split verts`);
      }
    },
  };
}

/** Recompute one mesh's normals from smooth groups, splitting at hard edges. `null` if it has no triangles. */
export function rebuildSmoothNormals(mesh: SubMesh, options: SmoothNormalsOptions = {}): null | Rebuilt {
  const triangles = mesh.triangles;
  if (triangles.length === 0) {
    return null;
  }
  const cosCrease = Math.cos(((options.creaseAngleDeg ?? DEFAULTS.creaseAngleDeg) * Math.PI) / 180);

  const canonId = weld(mesh.positions, options.weldEpsilon ?? DEFAULTS.weldEpsilon);
  const faces = faceData(mesh.positions, triangles);
  const groupOf = smoothGroups(triangles, canonId, faces, cosCrease);
  const groupNormals = accumulateGroupNormals(triangles, canonId, groupOf, faces);

  return emitSplitVertices(mesh, canonId, groupOf, groupNormals);
}

/** Area-weighted normal per `(welded vertex, group)`, keyed `${canonVertex}|${group}`. */
function accumulateGroupNormals(
  triangles: readonly Triangle[],
  canonId: Int32Array,
  groupOf: Int32Array,
  faces: Faces,
): Map<string, Vec3> {
  const accum = new Map<string, Vec3>();
  triangles.forEach((triangle, f) => {
    const group = groupOf[f];
    for (const vertex of [triangle.a, triangle.b, triangle.c]) {
      const key = `${canonId[vertex]}|${group}`;
      const sum = accum.get(key) ?? [0, 0, 0];
      sum[0] += faces.normal[f * 3] * faces.area[f];
      sum[1] += faces.normal[f * 3 + 1] * faces.area[f];
      sum[2] += faces.normal[f * 3 + 2] * faces.area[f];
      accum.set(key, sum);
    }
  });

  return accum;
}

function crossProduct(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Re-emit the mesh, **keeping the original vertices in place** (same indices/order) and only **appending** a
 * copy for each extra smooth group a vertex touches. This is critical: a vertex used by a single group is
 * untouched, so when no split is needed the vertex count + triangle indices are identical to the input — the
 * serializer then takes its safe attribute-overlay path. Reordering the whole array instead would desync the
 * struct's (unchanged) triangle indices on those models and shatter them.
 */
function emitSplitVertices(
  mesh: SubMesh,
  canonId: Int32Array,
  groupOf: Int32Array,
  groupNormals: Map<string, Vec3>,
): Rebuilt {
  const vertexCount = mesh.positions.length / 3;
  const positions = [...mesh.positions];
  const normals = new Array<number>(vertexCount * 3).fill(0);
  const uvs = mesh.uvs ? [...mesh.uvs] : null;
  const prelit = mesh.prelitColors ? [...mesh.prelitColors] : null;
  const night = mesh.nightColors ? [...mesh.nightColors] : null;
  const primaryGroup = new Int32Array(vertexCount).fill(-1);
  const appended = new Map<string, number>(); // `${originalVertex}|${group}` → appended index

  const normalFor = (original: number, group: number): Vec3 =>
    normalize(groupNormals.get(`${canonId[original]}|${group}`) ?? [0, 0, 1]);

  const resolve = (original: number, group: number): number => {
    if (primaryGroup[original] === -1) {
      primaryGroup[original] = group; // this group owns the original slot
      const normal = normalFor(original, group);
      normals[original * 3] = normal[0];
      normals[original * 3 + 1] = normal[1];
      normals[original * 3 + 2] = normal[2];

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
    const index = positions.length / 3;
    appended.set(key, index);
    positions.push(mesh.positions[original * 3], mesh.positions[original * 3 + 1], mesh.positions[original * 3 + 2]);
    const normal = normalFor(original, group);
    normals.push(normal[0], normal[1], normal[2]);
    pushVec(uvs, mesh.uvs, original, 2);
    pushVec(prelit, mesh.prelitColors, original, 4);
    pushVec(night, mesh.nightColors, original, 4);

    return index;
  };

  const triangles = mesh.triangles.map((triangle, f) => ({
    a: resolve(triangle.a, groupOf[f]),
    b: resolve(triangle.b, groupOf[f]),
    c: resolve(triangle.c, groupOf[f]),
    material: triangle.material,
  }));

  return {
    nightColors: night ? Uint8Array.from(night) : null,
    normals: Float32Array.from(normals),
    positions: Float32Array.from(positions),
    prelitColors: prelit ? Uint8Array.from(prelit) : null,
    triangles,
    uvs: uvs ? Float32Array.from(uvs) : null,
  };
}

function faceData(positions: Float32Array, triangles: readonly Triangle[]): Faces {
  const normal = new Float64Array(triangles.length * 3);
  const area = new Float64Array(triangles.length);
  triangles.forEach((triangle, f) => {
    const a = vertexAt(positions, triangle.a);
    const cross = crossProduct(sub(vertexAt(positions, triangle.b), a), sub(vertexAt(positions, triangle.c), a));
    const length = Math.hypot(cross[0], cross[1], cross[2]);
    area[f] = length / 2;
    if (length > 1e-9) {
      normal[f * 3] = cross[0] / length;
      normal[f * 3 + 1] = cross[1] / length;
      normal[f * 3 + 2] = cross[2] / length;
    }
  });

  return { area, normal };
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);

  return length < 1e-9 ? [0, 0, 1] : [v[0] / length, v[1] / length, v[2] / length];
}

function pushVec(out: null | number[], source: ArrayLike<number> | null, index: number, size: number): void {
  if (out && source) {
    for (let i = 0; i < size; i += 1) {
      out.push(source[index * size + i]);
    }
  }
}

/** Union faces across smooth edges (dihedral ≤ crease); returns each face's group root. */
function smoothGroups(
  triangles: readonly Triangle[],
  canonId: Int32Array,
  faces: Faces,
  cosCrease: number,
): Int32Array {
  const parent = new Int32Array(triangles.length);
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
  triangles.forEach((triangle, f) => {
    const corners = [canonId[triangle.a], canonId[triangle.b], canonId[triangle.c]];
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
  });

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

  const group = new Int32Array(triangles.length);
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
