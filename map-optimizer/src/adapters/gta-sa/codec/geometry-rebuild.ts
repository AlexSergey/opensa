import type { SubMesh, Triangle } from '../../../core/ir';
import type { RwChunk } from './chunk';
import type { GeometryStruct } from './geometry-struct';

import { RW_BIN_MESH_PLG, RW_EXTENSION, RW_NIGHT_VERTEX_COLORS, RW_SKIN, RW_STRUCT } from './chunk';
import { decodeGeometryStruct, encodeGeometryStruct } from './geometry-struct';

/**
 * Rebuild a Geometry whose vertex and/or triangle count changed (plan 004): re-encode the Struct from the IR,
 * regenerate `BinMeshPLG` (trilist) and the per-vertex `NIGHT_VERTEX_COLORS` chunk, and recompute the bounding
 * sphere. Mutates the geometry chunk in place. Refuses (throws) on data the IR can't faithfully remap — skin,
 * >1 UV layer, ≠1 morph target — so a count-changing plugin on such a model fails per-asset rather than
 * silently corrupting it.
 */

const PRELIT_FLAG = 0x0008;
const NORMALS_FLAG = 0x0010;

/**
 * Add a `NIGHT_VERTEX_COLORS` chunk to a geometry that has none (plan 013 — synthesized night sets for
 * night-less models). No-op when the geometry already carries a night chunk (its bytes stay untouched) or when
 * `mesh.nightColors` is absent / count-mismatched. Appends into the EXTENSION (creating one if needed); the
 * chunk codec recomputes all container sizes on write. The new chunk inherits the geometry's RW version.
 */
export function addNightColorsIfMissing(geometry: RwChunk, mesh: SubMesh): void {
  const vertexCount = mesh.positions.length / 3;
  if (!mesh.nightColors || mesh.nightColors.length !== vertexCount * 4) {
    return;
  }
  const children = geometry.children ?? [];
  let extension = children.find((child) => child.type === RW_EXTENSION);
  if (extension?.children?.some((child) => child.type === RW_NIGHT_VERTEX_COLORS)) {
    return; // already has a night set — leave it byte-faithful
  }
  if (!extension) {
    extension = { children: [], type: RW_EXTENSION, version: geometry.version };
    children.push(extension);
    geometry.children = children;
  }
  extension.children ??= [];
  extension.children.push({
    data: buildNightColors(mesh.nightColors),
    type: RW_NIGHT_VERTEX_COLORS,
    version: geometry.version,
  });
}

export function rebuildGeometry(geometry: RwChunk, mesh: SubMesh): void {
  const children = geometry.children ?? [];
  const structChunk = children.find((child) => child.type === RW_STRUCT && child.data);
  if (!structChunk?.data) {
    throw new Error(`rebuild: "${mesh.name}" geometry has no Struct`);
  }
  const extension = children.find((child) => child.type === RW_EXTENSION);
  const original = decodeGeometryStruct(structChunk.data);

  if (original.morphs.length !== 1) {
    throw new Error(`rebuild unsupported: "${mesh.name}" has ${original.morphs.length} morph targets`);
  }
  if (original.uvLayers.length > 1) {
    throw new Error(`rebuild unsupported: "${mesh.name}" has ${original.uvLayers.length} UV layers`);
  }
  if (extension?.children?.some((child) => child.type === RW_SKIN)) {
    throw new Error(`rebuild unsupported: "${mesh.name}" is skinned`);
  }

  const vertexCount = mesh.positions.length / 3;
  const prelit = mesh.prelitColors?.length === vertexCount * 4 ? mesh.prelitColors : null;
  let flags = original.flags;
  flags = mesh.normals ? flags | NORMALS_FLAG : flags & ~NORMALS_FLAG;
  flags = prelit ? flags | PRELIT_FLAG : flags & ~PRELIT_FLAG;

  const rebuilt: GeometryStruct = {
    flags,
    morphs: [{ bounds: boundingSphere(mesh.positions), normals: mesh.normals, positions: mesh.positions }],
    native: original.native,
    numTriangles: mesh.triangles.length,
    numVertices: vertexCount,
    prelit,
    triangles: mesh.triangles.map((triangle) => ({ ...triangle })),
    uvLayers: mesh.uvs ? [mesh.uvs] : [],
  };
  structChunk.data = encodeGeometryStruct(rebuilt);

  const binMesh = extension?.children?.find((child) => child.type === RW_BIN_MESH_PLG);
  if (binMesh) {
    binMesh.data = buildBinMesh(mesh.triangles);
  }
  const night = extension?.children?.find((child) => child.type === RW_NIGHT_VERTEX_COLORS);
  if (night && mesh.nightColors?.length === vertexCount * 4) {
    night.data = buildNightColors(mesh.nightColors);
  }
}

/** A bounding sphere enclosing the vertices: AABB centre + farthest-vertex radius. */
function boundingSphere(positions: Float32Array): [number, number, number, number] {
  if (positions.length === 0) {
    return [0, 0, 0, 0];
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let radius = 0;
  for (let i = 0; i < positions.length; i += 3) {
    radius = Math.max(radius, Math.hypot(positions[i] - cx, positions[i + 1] - cy, positions[i + 2] - cz));
  }

  return [cx, cy, cz, radius];
}

/** A fresh trilist `BinMeshPLG` body: `flags=0, numMeshes, totalIndices`, then per material a split of its
 *  triangle indices (winding `a,b,c`, materials ascending). */
function buildBinMesh(triangles: readonly Triangle[]): Uint8Array {
  const byMaterial = new Map<number, number[]>();
  for (const triangle of triangles) {
    let indices = byMaterial.get(triangle.material);
    if (!indices) {
      indices = [];
      byMaterial.set(triangle.material, indices);
    }
    indices.push(triangle.a, triangle.b, triangle.c);
  }
  const materials = [...byMaterial.keys()].sort((a, b) => a - b);
  const totalIndices = materials.reduce((sum, material) => sum + byMaterial.get(material)!.length, 0);

  const out = new Uint8Array(12 + materials.length * 8 + totalIndices * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0, true); // flags: 0 = trilist
  view.setUint32(4, materials.length, true);
  view.setUint32(8, totalIndices, true);
  let offset = 12;
  for (const material of materials) {
    const indices = byMaterial.get(material)!;
    view.setUint32(offset, indices.length, true);
    view.setUint32(offset + 4, material, true);
    offset += 8;
    for (const index of indices) {
      view.setUint32(offset, index, true);
      offset += 4;
    }
  }

  return out;
}

/** A `NIGHT_VERTEX_COLORS` body: `present u32 = 1`, then RGBA × V. */
function buildNightColors(nightColors: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + nightColors.length);
  new DataView(out.buffer).setUint32(0, 1, true);
  out.set(nightColors, 4);

  return out;
}
