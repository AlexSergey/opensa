import type { SubMesh, Triangle } from '../core/ir';

/**
 * Rebuild a sub-mesh's per-vertex arrays + triangles from a vertex remapping — shared by `weld-vertices` and
 * `prune-vertices`. `sourceOf[newIndex]` is an old vertex index to copy every attribute from; `oldToNew` maps
 * each old index to its new one (for re-indexing the faces). The caller decides which vertices merge or drop.
 */
export function remapVertices(mesh: SubMesh, oldToNew: Int32Array, sourceOf: readonly number[]): void {
  mesh.positions = pickFloats(mesh.positions, sourceOf, 3);
  if (mesh.normals) {
    mesh.normals = pickFloats(mesh.normals, sourceOf, 3);
  }
  if (mesh.uvs) {
    mesh.uvs = pickFloats(mesh.uvs, sourceOf, 2);
  }
  if (mesh.extraUvs?.length) {
    mesh.extraUvs = mesh.extraUvs.map((layer) => pickFloats(layer, sourceOf, 2));
  }
  if (mesh.prelitColors) {
    mesh.prelitColors = pickBytes(mesh.prelitColors, sourceOf, 4);
  }
  if (mesh.nightColors) {
    mesh.nightColors = pickBytes(mesh.nightColors, sourceOf, 4);
  }
  mesh.triangles = mesh.triangles.map(
    (triangle): Triangle => ({
      a: oldToNew[triangle.a],
      b: oldToNew[triangle.b],
      c: oldToNew[triangle.c],
      material: triangle.material,
    }),
  );
}

function pickBytes(source: Uint8Array, sourceOf: readonly number[], stride: number): Uint8Array {
  const out = new Uint8Array(sourceOf.length * stride);
  for (let i = 0; i < sourceOf.length; i += 1) {
    const from = sourceOf[i] * stride;
    for (let k = 0; k < stride; k += 1) {
      out[i * stride + k] = source[from + k];
    }
  }

  return out;
}

function pickFloats(source: Float32Array, sourceOf: readonly number[], stride: number): Float32Array {
  const out = new Float32Array(sourceOf.length * stride);
  for (let i = 0; i < sourceOf.length; i += 1) {
    const from = sourceOf[i] * stride;
    for (let k = 0; k < stride; k += 1) {
      out[i * stride + k] = source[from + k];
    }
  }

  return out;
}
