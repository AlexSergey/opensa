/**
 * Shared world-boundary geometry helpers for the plan 016 seam weld and the plan 017 gap stitch: boundary-edge
 * detection, area-weighted normals, the engine's conjugated-quaternion placement transform (+ its inverse), and
 * a spatial-hash grouping. Pure + archive-free. The world transform matches the engine's map convention exactly
 * (position + **conjugated** IPL quaternion, unit scale, DFF frame transforms ignored — see `build-region.ts`).
 */

/** An open edge (used by exactly one triangle): its two vertices `a`,`b` + the owning triangle's third vertex. */
export interface OpenEdge {
  a: number;
  apex: number;
  b: number;
}

/** An IPL instance placement: world position + orientation quaternion `(x, y, z, w)`. */
export interface Placement {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export type Vec3 = [number, number, number];

/** A boundary vertex resolved into world space — the unit the spatial grouping operates on. */
export interface WorldPoint {
  world: Vec3;
  worldNormal: Vec3;
}

/** Open edges (used by exactly one triangle), each with its owning triangle's third vertex (`apex`). */
export function boundaryEdges(triangles: readonly { a: number; b: number; c: number }[]): OpenEdge[] {
  const edges = new Map<string, { a: number; apex: number; b: number; count: number }>();
  const bump = (u: number, v: number, w: number): void => {
    const key = u < v ? `${u},${v}` : `${v},${u}`;
    const entry = edges.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      edges.set(key, { a: u, apex: w, b: v, count: 1 });
    }
  };
  for (const t of triangles) {
    bump(t.a, t.b, t.c);
    bump(t.b, t.c, t.a);
    bump(t.c, t.a, t.b);
  }

  return [...edges.values()].filter((edge) => edge.count === 1).map(({ a, apex, b }) => ({ a, apex, b }));
}

/** Vertex indices touched by a boundary edge (an edge used by exactly one triangle). */
export function boundaryVertices(triangles: readonly { a: number; b: number; c: number }[]): Set<number> {
  const boundary = new Set<number>();
  for (const { a, b } of boundaryEdges(triangles)) {
    boundary.add(a);
    boundary.add(b);
  }

  return boundary;
}

/**
 * Group points that are within `maxDistance` in world space **and** whose world normals agree (dot ≥ `normalCos`).
 * A uniform grid (cell = `maxDistance`) bounds each neighbour scan to 27 cells. Returns index arrays (one per
 * connected component).
 */
export function connectedGroups(points: readonly WorldPoint[], maxDistance: number, normalCos: number): number[][] {
  const parent = new Int32Array(points.length);
  for (let i = 0; i < parent.length; i += 1) {
    parent[i] = i;
  }
  const grid = spatialGrid(points, maxDistance);
  const maxSquared = maxDistance * maxDistance;
  points.forEach((point, i) => {
    for (const j of neighbourIndices(grid, point.world, maxDistance)) {
      if (
        j > i &&
        distanceSquared(point.world, points[j].world) <= maxSquared &&
        dot(point.worldNormal, points[j].worldNormal) >= normalCos
      ) {
        parent[find(parent, j)] = find(parent, i);
      }
    }
  });

  const groups = new Map<number, number[]>();
  for (let i = 0; i < points.length; i += 1) {
    const root = find(parent, i);
    const list = groups.get(root);
    if (list) {
      list.push(i);
    } else {
      groups.set(root, [i]);
    }
  }

  return [...groups.values()];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];

  return dx * dx + dy * dy + dz * dz;
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Yield every point index in the 27 grid cells around `world` (its own cell + neighbours). */
export function* neighbourIndices(grid: ReadonlyMap<string, number[]>, world: Vec3, cell: number): Generator<number> {
  const cx = Math.floor(world[0] / cell);
  const cy = Math.floor(world[1] / cell);
  const cz = Math.floor(world[2] / cell);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (bucket) {
          yield* bucket;
        }
      }
    }
  }
}

/** Rotate a vector by the **conjugate** of quaternion `q` (three.js `applyQuaternion` with `q` negated x/y/z). */
export function rotateByConjugate(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
): Vec3 {
  return applyQuaternion(-q[0], -q[1], -q[2], q[3], v);
}

/** Bucket point indices into a uniform grid keyed by cell, so a neighbour scan touches only 27 cells. */
export function spatialGrid(points: readonly { world: Vec3 }[], cell: number): Map<string, number[]> {
  const grid = new Map<string, number[]>();
  points.forEach((point, i) => {
    const key = `${Math.floor(point.world[0] / cell)},${Math.floor(point.world[1] / cell)},${Math.floor(point.world[2] / cell)}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      grid.set(key, [i]);
    }
  });

  return grid;
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Transform a model-local point into world space by an IPL placement: `position + conjugate(rotation) · point`,
 * unit scale. The conjugate matches the engine's map convention, so results land where the game draws them.
 */
export function transformToWorld(placement: Placement, point: readonly [number, number, number]): Vec3 {
  const r = rotateByConjugate(placement.rotation, point);

  return [placement.position[0] + r[0], placement.position[1] + r[1], placement.position[2] + r[2]];
}

/** Area-weighted per-vertex normals in model-local space (flattened xyz). */
export function vertexNormals(
  positions: Float32Array,
  triangles: readonly { a: number; b: number; c: number }[],
): Float32Array {
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const at = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  for (const t of triangles) {
    const a = at(t.a);
    const faceNormal = cross(sub(at(t.b), a), sub(at(t.c), a)); // length = 2 × area (area-weights the sum)
    for (const v of [t.a, t.b, t.c]) {
      normals[v * 3] += faceNormal[0];
      normals[v * 3 + 1] += faceNormal[1];
      normals[v * 3 + 2] += faceNormal[2];
    }
  }
  for (let v = 0; v < count; v += 1) {
    const length = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= length;
    normals[v * 3 + 1] /= length;
    normals[v * 3 + 2] /= length;
  }

  return normals;
}

/** Inverse of {@link transformToWorld}: `rotation · (world − position)` (undo the conjugate + translation). */
export function worldToLocal(placement: Placement, world: readonly [number, number, number]): Vec3 {
  const d: Vec3 = [
    world[0] - placement.position[0],
    world[1] - placement.position[1],
    world[2] - placement.position[2],
  ];

  return applyQuaternion(placement.rotation[0], placement.rotation[1], placement.rotation[2], placement.rotation[3], d);
}

/** three.js `Vector3.applyQuaternion` for quaternion `(qx,qy,qz,qw)`. */
function applyQuaternion(qx: number, qy: number, qz: number, qw: number, v: readonly [number, number, number]): Vec3 {
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);

  return [
    v[0] + qw * tx + (qy * tz - qz * ty),
    v[1] + qw * ty + (qz * tx - qx * tz),
    v[2] + qw * tz + (qx * ty - qy * tx),
  ];
}

function find(parent: Int32Array, i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }

  return i;
}
