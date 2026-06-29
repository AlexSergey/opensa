import {
  appendSplitsF32,
  appendSplitsU8,
  rebuildSmoothNormals,
  type SmoothNormalsOptions,
} from '@opensa/tool-kit/mesh/smooth-normals';

import type { MergedGroup, MergedMesh } from './mesh';

/**
 * Re-derive a merged cell mesh's normals from smooth groups (plan 015, shared `tool-kit` core) so flat ground
 * stays flat and building edges stay sharp — the merged HD geometry's source normals are inconsistent across
 * models and meaningless after welding. All per-texture groups are flattened into one index stream (the core
 * needs the whole mesh's adjacency), rebuilt, then split back into the same groups; positions/UVs/colours grow
 * to match the appended split vertices. A mesh with no triangles is returned unchanged.
 */
export function rebuildMeshNormals(mesh: MergedMesh, options: SmoothNormalsOptions = {}): MergedMesh {
  const total = mesh.groups.reduce((sum, group) => sum + group.indices.length, 0);
  if (total === 0) {
    return mesh;
  }
  const flat = new Uint32Array(total);
  let offset = 0;
  for (const group of mesh.groups) {
    flat.set(group.indices, offset);
    offset += group.indices.length;
  }

  const result = rebuildSmoothNormals(mesh.positions, flat, options);
  if (!result) {
    return mesh;
  }

  const groups: MergedGroup[] = [];
  let at = 0;
  for (const group of mesh.groups) {
    groups.push({ indices: result.indices.slice(at, at + group.indices.length), texture: group.texture });
    at += group.indices.length;
  }

  return {
    colors: appendSplitsU8(mesh.colors, result.splitSources, 4),
    groups,
    ...(mesh.nightColors ? { nightColors: appendSplitsU8(mesh.nightColors, result.splitSources, 4) } : {}),
    normals: result.normals,
    positions: appendSplitsF32(mesh.positions, result.splitSources, 3),
    uvs: appendSplitsF32(mesh.uvs, result.splitSources, 2),
  };
}
