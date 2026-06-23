import type { RWClump, RWGeometry } from '../../../src/renderware/parsers/binary/types';
import type { MeshIR, SubMesh } from '../../core/ir';

/** RenderWare clump → neutral mesh IR (one {@link SubMesh} per geometry). Read-only reuse of the main
 *  project's parser; nothing in `../src` is modified. */
export function clumpToIr(clump: RWClump): MeshIR {
  return { meshes: clump.geometries.map(toSubMesh) };
}

function toSubMesh(geometry: RWGeometry, index: number): SubMesh {
  return {
    materialCount: geometry.materials.length,
    name: `geometry_${index}`,
    nightColors: geometry.nightColors,
    normals: geometry.normals,
    positions: geometry.positions,
    prelitColors: geometry.prelitColors,
    triangles: geometry.triangles.map((triangle) => ({
      a: triangle.a,
      b: triangle.b,
      c: triangle.c,
      material: triangle.materialIndex,
    })),
    uvs: geometry.uvLayers[0] ?? null,
  };
}
