import type { MapPlugin } from '../core/asset';
import type { SubMesh, Triangle } from '../core/ir';

/**
 * Apply the gap-stitch **boundary skirts** computed by the world pre-pass (`adapters/gta-sa/gap-stitch.ts`, plan
 * 017, variant D). For each flagged wide-gap horizontal boundary edge it extrudes a thin **downward skirt**: two
 * new vertices below the edge (a copy of the edge vertices — same UV / prelit / material — moved down) and a
 * **double-sided** quad, so looking through the crack you see the surface continue down instead of sky / water.
 * Doesn't close the seam; occludes the void behind it — the tool for gaps too wide for A/B.
 *
 * Matching is by the edge's **local endpoint positions**; the skirt inherits the owning triangle's material. Adds
 * vertices + triangles, so it rides the count-changing `rebuildGeometry` path.
 */

/** A boundary edge to skirt: its endpoints and their extruded (downward) positions, all in model-local space. */
export interface SkirtOverride {
  a: readonly [number, number, number];
  b: readonly [number, number, number];
  belowA: readonly [number, number, number];
  belowB: readonly [number, number, number];
}

/** A vertex to append: a copy of `src`'s attributes with its position overridden to `pos`. */
interface NewVertex {
  pos: readonly [number, number, number];
  src: number;
}

export function createSkirtBoundary(skirtsByModel: ReadonlyMap<string, readonly SkirtOverride[]>): MapPlugin {
  return {
    accepts: (asset): boolean => skirtsByModel.has(asset.name),
    name: 'skirt-boundary',
    transform(asset, context): void {
      const skirts = skirtsByModel.get(asset.name);
      if (!skirts || skirts.length === 0) {
        return;
      }
      let added = 0;
      for (const mesh of asset.ir.meshes) {
        added += skirtMesh(mesh, skirts);
      }
      if (added > 0) {
        asset.dirty = true;
        context.log(asset, 'skirt-boundary', `added ${added} boundary skirt(s)`);
      }
    },
  };
}

function copyGrowBytes(source: Uint8Array, newVertices: readonly NewVertex[]): Uint8Array {
  const out = new Uint8Array(source.length + newVertices.length * 4);
  out.set(source, 0);
  newVertices.forEach((nv, k) => {
    out.set(source.subarray(nv.src * 4, nv.src * 4 + 4), source.length + k * 4);
  });

  return out;
}

function copyGrowFloats(source: Float32Array, stride: number, newVertices: readonly NewVertex[]): Float32Array {
  const out = new Float32Array(source.length + newVertices.length * stride);
  out.set(source, 0);
  newVertices.forEach((nv, k) => {
    out.set(source.subarray(nv.src * stride, nv.src * stride + stride), source.length + k * stride);
  });

  return out;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Map each triangle edge to its material (a boundary edge belongs to exactly one triangle). */
function edgeMaterials(triangles: readonly Triangle[]): Map<string, number> {
  const material = new Map<string, number>();
  for (const t of triangles) {
    material.set(edgeKey(t.a, t.b), t.material);
    material.set(edgeKey(t.b, t.c), t.material);
    material.set(edgeKey(t.c, t.a), t.material);
  }

  return material;
}

/** Grow every present per-vertex attribute: positions take the new position, the rest copy the source vertex. */
function growCopied(mesh: SubMesh, newVertices: readonly NewVertex[]): void {
  const positions = new Float32Array(mesh.positions.length + newVertices.length * 3);
  positions.set(mesh.positions, 0);
  newVertices.forEach((nv, k) => {
    positions.set(nv.pos, mesh.positions.length + k * 3);
  });
  mesh.positions = positions;

  if (mesh.normals) {
    mesh.normals = copyGrowFloats(mesh.normals, 3, newVertices);
  }
  if (mesh.uvs) {
    mesh.uvs = copyGrowFloats(mesh.uvs, 2, newVertices);
  }
  if (mesh.extraUvs) {
    mesh.extraUvs = mesh.extraUvs.map((layer) => copyGrowFloats(layer, 2, newVertices));
  }
  if (mesh.prelitColors) {
    mesh.prelitColors = copyGrowBytes(mesh.prelitColors, newVertices);
  }
  if (mesh.nightColors) {
    mesh.nightColors = copyGrowBytes(mesh.nightColors, newVertices);
  }
}

function positionKey(pos: readonly [number, number, number]): string {
  return `${pos[0]}|${pos[1]}|${pos[2]}`;
}

/** Extrude every flagged edge of one mesh into a double-sided skirt; returns the number of skirts added. */
function skirtMesh(mesh: SubMesh, skirts: readonly SkirtOverride[]): number {
  const count = mesh.positions.length / 3;
  const indexOf = new Map<string, number>();
  for (let v = 0; v < count; v += 1) {
    indexOf.set(positionKey([mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]]), v);
  }
  const material = edgeMaterials(mesh.triangles);

  const newVertices: NewVertex[] = [];
  const newTriangles: Triangle[] = [];
  for (const skirt of skirts) {
    const ia = indexOf.get(positionKey(skirt.a));
    const ib = indexOf.get(positionKey(skirt.b));
    const m = ia !== undefined && ib !== undefined ? material.get(edgeKey(ia, ib)) : undefined;
    if (ia === undefined || ib === undefined || m === undefined) {
      continue; // the edge isn't a boundary edge of this geometry
    }
    const belowA = count + newVertices.length;
    newVertices.push({ pos: skirt.belowA, src: ia });
    const belowB = count + newVertices.length;
    newVertices.push({ pos: skirt.belowB, src: ib });
    // Double-sided quad ia–ib–belowB–belowA so it occludes from either side.
    newTriangles.push(
      { a: ia, b: ib, c: belowB, material: m },
      { a: ia, b: belowB, c: belowA, material: m },
      { a: ia, b: belowB, c: ib, material: m },
      { a: ia, b: belowA, c: belowB, material: m },
    );
  }
  if (newVertices.length === 0) {
    return 0;
  }

  growCopied(mesh, newVertices);
  mesh.triangles = [...mesh.triangles, ...newTriangles];

  return newVertices.length / 2;
}
