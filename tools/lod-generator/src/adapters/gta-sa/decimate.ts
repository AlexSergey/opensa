import { simplify, type SimplifyMesh } from '@opensa/tool-kit/mesh/simplify';

import type { MergedGroup, MergedMesh } from '../../core/types';

/**
 * QEM-decimate a merged cell mesh to a far-view triangle budget (plan 002, 1c) via the shared `tool-kit`
 * simplifier. Each per-texture group becomes a face group, so collapses across texture seams (and the cell's
 * open silhouette) are pinned — the far contour and material edges survive. UV + colour ride along as
 * interpolated attributes; normals are dropped (the downstream normals pass re-derives them on the result).
 * A mesh already under budget is returned unchanged.
 */
export function decimateMesh(mesh: MergedMesh, targetTriangles: number): MergedMesh {
  const faceCount = mesh.groups.reduce((sum, group) => sum + group.indices.length / 3, 0);
  if (faceCount <= targetTriangles) {
    return mesh;
  }

  const result = simplify(toSimplifyMesh(mesh), targetTriangles);
  const [uv, color] = result.attributes;

  return {
    colors: Uint8Array.from(color.data, (c) => Math.max(0, Math.min(255, Math.round(c)))),
    groups: regroup(result.faces, result.faceGroup, mesh.groups),
    normals: new Float32Array(result.positions.length), // zero — re-derived by the normals pass
    positions: Float32Array.from(result.positions),
    uvs: Float32Array.from(uv.data),
  };
}

/** Rebuild per-texture {@link MergedGroup}s from the simplified faces + their (preserved) group ids. */
function regroup(faces: Int32Array, faceGroup: Int32Array, source: readonly MergedGroup[]): MergedGroup[] {
  const byGroup = source.map(() => [] as number[]);
  for (let f = 0; f < faceGroup.length; f += 1) {
    byGroup[faceGroup[f]].push(faces[f * 3], faces[f * 3 + 1], faces[f * 3 + 2]);
  }

  return source
    .map((group, g) => ({ indices: Uint32Array.from(byGroup[g]), texture: group.texture }))
    .filter((group) => group.indices.length > 0);
}

/** Flatten the per-texture groups into faces + a face-group id, with UV/colour as interpolated attributes. */
function toSimplifyMesh(mesh: MergedMesh): SimplifyMesh {
  const faceCount = mesh.groups.reduce((sum, group) => sum + group.indices.length / 3, 0);
  const faces = new Int32Array(faceCount * 3);
  const faceGroup = new Int32Array(faceCount);
  let f = 0;
  mesh.groups.forEach((group, g) => {
    for (let i = 0; i < group.indices.length; i += 3, f += 1) {
      faces[f * 3] = group.indices[i];
      faces[f * 3 + 1] = group.indices[i + 1];
      faces[f * 3 + 2] = group.indices[i + 2];
      faceGroup[f] = g;
    }
  });

  return {
    attributes: [
      { data: Float64Array.from(mesh.uvs), size: 2 },
      { data: Float64Array.from(mesh.colors), size: 4 },
    ],
    faceGroup,
    faces,
    positions: Float64Array.from(mesh.positions),
  };
}
