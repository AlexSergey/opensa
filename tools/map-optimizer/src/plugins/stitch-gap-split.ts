import type { MapPlugin } from '../core/asset';
import type { SubMesh, Triangle } from '../core/ir';

/**
 * Apply the gap-stitch **edge splits** computed by the world pre-pass (`adapters/gta-sa/gap-stitch.ts`, plan 017,
 * variant B). For the current model it splits each flagged boundary edge at the flagged parameter(s): a new
 * vertex is inserted on the edge (every attribute the **exact linear interpolation** of the endpoints — no
 * guessing), and the single triangle that owns the boundary edge is re-triangulated as a fan so the surface is
 * unchanged in shape but now carries the point, killing the T-junction with the neighbour.
 *
 * Matching is by the edge's **local endpoint positions**. Adds vertices + triangles, so it rides the
 * count-changing `rebuildGeometry` path. Runs **first** (before the position move + weld / smooth-normals).
 */

/** A boundary edge to split (local endpoint positions) at parameter `t ∈ (0, 1)` measured first → second. */
export interface EdgeSplitOverride {
  edge: readonly [readonly [number, number, number], readonly [number, number, number]];
  t: number;
}

/** A vertex to append: the linear interpolation of vertices `a` and `b` at `t`. */
interface NewVertex {
  a: number;
  b: number;
  t: number;
}

export function createStitchGapSplit(splitsByModel: ReadonlyMap<string, readonly EdgeSplitOverride[]>): MapPlugin {
  return {
    accepts: (asset): boolean => splitsByModel.has(asset.name),
    name: 'stitch-gap-split',
    transform(asset, context): void {
      const splits = splitsByModel.get(asset.name);
      if (!splits || splits.length === 0) {
        return;
      }
      let inserted = 0;
      for (const mesh of asset.ir.meshes) {
        inserted += splitMesh(mesh, splits);
      }
      if (inserted > 0) {
        asset.dirty = true;
        context.log(asset, 'stitch-gap-split', `split ${inserted} boundary edge point(s)`);
      }
    },
  };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Grow every present per-vertex attribute by the interpolated new vertices. */
function growAttributes(mesh: SubMesh, newVertices: readonly NewVertex[]): void {
  mesh.positions = lerpGrowFloats(mesh.positions, 3, newVertices);
  if (mesh.normals) {
    mesh.normals = lerpGrowFloats(mesh.normals, 3, newVertices);
  }
  if (mesh.uvs) {
    mesh.uvs = lerpGrowFloats(mesh.uvs, 2, newVertices);
  }
  if (mesh.extraUvs) {
    mesh.extraUvs = mesh.extraUvs.map((layer) => lerpGrowFloats(layer, 2, newVertices));
  }
  if (mesh.prelitColors) {
    mesh.prelitColors = lerpGrowBytes(mesh.prelitColors, newVertices);
  }
  if (mesh.nightColors) {
    mesh.nightColors = lerpGrowBytes(mesh.nightColors, newVertices);
  }
}

function lerpGrowBytes(source: Uint8Array, newVertices: readonly NewVertex[]): Uint8Array {
  const out = new Uint8Array(source.length + newVertices.length * 4);
  out.set(source, 0);
  newVertices.forEach((nv, k) => {
    for (let c = 0; c < 4; c += 1) {
      out[source.length + k * 4 + c] = Math.round(source[nv.a * 4 + c] * (1 - nv.t) + source[nv.b * 4 + c] * nv.t);
    }
  });

  return out;
}

function lerpGrowFloats(source: Float32Array, stride: number, newVertices: readonly NewVertex[]): Float32Array {
  const out = new Float32Array(source.length + newVertices.length * stride);
  out.set(source, 0);
  newVertices.forEach((nv, k) => {
    for (let c = 0; c < stride; c += 1) {
      out[source.length + k * stride + c] = source[nv.a * stride + c] * (1 - nv.t) + source[nv.b * stride + c] * nv.t;
    }
  });

  return out;
}

function positionKey(pos: readonly [number, number, number]): string {
  return `${pos[0]}|${pos[1]}|${pos[2]}`;
}

/** Re-triangulate one triangle as a fan through the split points on its edges (unchanged if none). */
function retriangulate(
  triangle: Triangle,
  byEdge: ReadonlyMap<string, { ip: number; iq: number; points: { index: number; t: number }[] }>,
): Triangle[] {
  const corners = [triangle.a, triangle.b, triangle.c];
  const polygon: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    const va = corners[i];
    const vb = corners[(i + 1) % 3];
    polygon.push(va);
    const entry = byEdge.get(edgeKey(va, vb));
    if (entry) {
      // Order the inserted points along va → vb (the split `t` is measured entry.ip → entry.iq).
      const along = entry.points.map((p) => ({ index: p.index, s: entry.ip === va ? p.t : 1 - p.t }));
      along.sort((x, y) => x.s - y.s);
      for (const p of along) {
        polygon.push(p.index);
      }
    }
  }
  if (polygon.length === 3) {
    return [triangle];
  }

  const fan: Triangle[] = [];
  for (let k = 1; k < polygon.length - 1; k += 1) {
    fan.push({ a: polygon[0], b: polygon[k], c: polygon[k + 1], material: triangle.material });
  }

  return fan;
}

/** Split every flagged edge of one mesh; returns the number of vertices inserted. */
function splitMesh(mesh: SubMesh, splits: readonly EdgeSplitOverride[]): number {
  const indexOf = new Map<string, number>();
  const count = mesh.positions.length / 3;
  for (let v = 0; v < count; v += 1) {
    indexOf.set(positionKey([mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]), v);
  }

  // Resolve each split to an (edge, param) in THIS mesh; a new vertex per split point.
  const newVertices: NewVertex[] = [];
  const byEdge = new Map<string, { ip: number; iq: number; points: { index: number; t: number }[] }>();
  for (const split of splits) {
    const ip = indexOf.get(positionKey(split.edge[0]));
    const iq = indexOf.get(positionKey(split.edge[1]));
    if (ip === undefined || iq === undefined) {
      continue; // the edge lives in another geometry
    }
    const key = edgeKey(ip, iq);
    const entry = byEdge.get(key) ?? { ip, iq, points: [] };
    entry.points.push({ index: count + newVertices.length, t: split.t });
    newVertices.push({ a: ip, b: iq, t: split.t });
    byEdge.set(key, entry);
  }
  if (newVertices.length === 0) {
    return 0;
  }

  growAttributes(mesh, newVertices);
  mesh.triangles = mesh.triangles.flatMap((triangle) => retriangulate(triangle, byEdge));

  return newVertices.length;
}
