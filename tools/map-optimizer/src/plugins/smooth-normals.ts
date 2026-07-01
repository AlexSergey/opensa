import type { SmoothNormalsOptions } from '@opensa/tool-kit/mesh/smooth-normals';

import {
  appendSplitsF32,
  appendSplitsU8,
  rebuildSmoothNormals as rebuildCore,
} from '@opensa/tool-kit/mesh/smooth-normals';

import type { MapPlugin } from '../core/asset';
import type { SubMesh } from '../core/ir';

/**
 * Rebuild per-vertex normals from **smooth groups** (plan 015): SA prelit world geometry ships with broken or
 * absent normals, so the engine falls back to a naive whole-mesh average — smearing walls into gradients,
 * cancelling to zero at double faces, and feeding SSAO garbage (dark edges). The smooth-group algorithm lives in
 * `tool-kit` (shared with opensa-lod-generator); this adapter maps a {@link SubMesh} into its raw positions + index
 * triples, then re-expands the result — duplicating UV/prelit/night onto each split vertex so seams survive.
 *
 * Result: flat walls stay flat, hard edges stay sharp, double faces get correct outward normals — no blended
 * gradients, no zero-cancel slivers. Vertex count grows at hard edges (rides the count-changing serializer).
 */

export type { SmoothNormalsOptions };

type Rebuilt = Pick<
  SubMesh,
  'extraUvs' | 'nightColors' | 'normals' | 'positions' | 'prelitColors' | 'triangles' | 'uvs'
>;

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

/**
 * Recompute one mesh's normals via the shared smooth-group core, re-expanding split vertices with this mesh's
 * attributes (UV / prelit / night). `null` if it has no triangles.
 */
export function rebuildSmoothNormals(mesh: SubMesh, options: SmoothNormalsOptions = {}): null | Rebuilt {
  if (mesh.triangles.length === 0) {
    return null;
  }
  const indices = new Uint32Array(mesh.triangles.length * 3);
  mesh.triangles.forEach((triangle, f) => {
    indices[f * 3] = triangle.a;
    indices[f * 3 + 1] = triangle.b;
    indices[f * 3 + 2] = triangle.c;
  });

  const result = rebuildCore(mesh.positions, indices, options);
  if (!result) {
    return null;
  }
  const { splitSources } = result;

  return {
    extraUvs: mesh.extraUvs?.map((layer) => appendSplitsF32(layer, splitSources, 2)),
    nightColors: mesh.nightColors ? appendSplitsU8(mesh.nightColors, splitSources, 4) : null,
    normals: result.normals,
    positions: appendSplitsF32(mesh.positions, splitSources, 3),
    prelitColors: mesh.prelitColors ? appendSplitsU8(mesh.prelitColors, splitSources, 4) : null,
    triangles: mesh.triangles.map((triangle, f) => ({
      a: result.indices[f * 3],
      b: result.indices[f * 3 + 1],
      c: result.indices[f * 3 + 2],
      material: triangle.material,
    })),
    uvs: mesh.uvs ? appendSplitsF32(mesh.uvs, splitSources, 2) : null,
  };
}
