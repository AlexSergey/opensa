import { simplify, type SimplifyMesh } from '@opensa/tool-kit/mesh/simplify';

import type { MergedGroup, MergedMesh } from './mesh';

/**
 * Cap a collapse from stretching an edge beyond this × the model's longest input edge. QEM freely slivers flat
 * surfaces (roads, walls, ground) into long thin spikes — e.g. a building's 9-unit edges grow to 50+ — which read
 * as spikes poking out of the LOD. 1.5 keeps each decimated model's longest edge close to the original's with no
 * triangle-budget cost (it just steers collapses), so surfaces stay flat instead of spiking.
 */
const MAX_EDGE_FACTOR = 1.5;

/**
 * Floor on faces kept per texture group. QEM collapses flat surfaces (zero in-plane error, boundary pin only
 * resists perpendicular motion) all the way to nothing, deleting whole textured surfaces → holes in the LOD. This
 * keeps every surface present with at least a coarse quad.
 */
const MIN_FACES_PER_GROUP = 2;

/**
 * QEM-decimate a merged mesh to a triangle budget (plan 002, 1c) via the shared `tool-kit` simplifier. Each
 * per-texture group becomes a face group, so collapses across texture seams (and the open silhouette) are pinned
 * — the contour and material edges survive. UV + colour (+ night colour when present) ride along as interpolated
 * attributes; normals are dropped (the downstream normals pass re-derives them). Collapses are edge-length capped
 * ({@link MAX_EDGE_FACTOR}) so flat surfaces don't sliver into spikes, and every group keeps
 * {@link MIN_FACES_PER_GROUP} faces so no surface vanishes. Vertices are **not** welded — fusing coincident verts
 * across a UV seam smears textures, and across stacked terrain layers collapses coverage. A mesh already under
 * budget is returned unchanged.
 */
export function decimateMesh(mesh: MergedMesh, targetTriangles: number): MergedMesh {
  const faceCount = mesh.groups.reduce((sum, group) => sum + group.indices.length / 3, 0);
  if (faceCount <= targetTriangles) {
    return mesh;
  }

  const result = simplify(toSimplifyMesh(mesh), targetTriangles, {
    maxEdgeFactor: MAX_EDGE_FACTOR,
    minFacesPerGroup: MIN_FACES_PER_GROUP,
  });
  const [uv, color, night] = result.attributes;
  const u8 = (data: ArrayLike<number>): Uint8Array =>
    Uint8Array.from(data, (c) => Math.max(0, Math.min(255, Math.round(c))));

  return {
    colors: u8(color.data),
    groups: regroup(result.faces, result.faceGroup, mesh.groups),
    // `night` is present only when the source mesh carried night colours (the optional 3rd attribute).
    ...(night ? { nightColors: u8(night.data) } : {}),
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

/** Flatten the per-texture groups into faces + a face-group id, with UV/colour (+ night) as interpolated attributes. */
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

  // Order matters — decimateMesh destructures [uv, color, night?]; `night` (optional) stays last.
  const attributes = [
    { data: Float64Array.from(mesh.uvs), size: 2 },
    { data: Float64Array.from(mesh.colors), size: 4 },
  ];
  if (mesh.nightColors) {
    attributes.push({ data: Float64Array.from(mesh.nightColors), size: 4 });
  }

  return { attributes, faceGroup, faces, positions: Float64Array.from(mesh.positions) };
}
