import type { MeshIR } from '../../../core/ir';
import type { RwChunk } from './chunk';

import { readRw, RW_CLUMP, RW_GEOMETRY, RW_GEOMETRY_LIST, RW_STRUCT, writeRw } from './chunk';
import { addNightColorsIfMissing, rebuildGeometry } from './geometry-rebuild';
import { applyMeshToStruct } from './geometry-struct';

/** Every Geometry chunk, in document order (matches the IR's `meshes` order). */
export function collectGeometries(chunks: readonly RwChunk[]): RwChunk[] {
  const geometries: RwChunk[] = [];
  for (const clump of chunks) {
    if (clump.type !== RW_CLUMP) {
      continue;
    }
    for (const list of clump.children ?? []) {
      if (list.type !== RW_GEOMETRY_LIST) {
        continue;
      }
      for (const geometry of list.children ?? []) {
        if (geometry.type === RW_GEOMETRY) {
          geometries.push(geometry);
        }
      }
    }
  }

  return geometries;
}

/** The Struct leaf of every Geometry, in document order (for tests). */
export function collectGeometryStructs(chunks: readonly RwChunk[]): RwChunk[] {
  return collectGeometries(chunks)
    .map((geometry) => geometry.children?.find((child) => child.type === RW_STRUCT && child.data))
    .filter((struct): struct is RwChunk => Boolean(struct));
}

/**
 * Serialize a (possibly edited) {@link MeshIR} back to DFF bytes. Reads the source into a faithful chunk tree,
 * then per geometry either **overlays** the IR attributes onto the existing Struct (when vertex + triangle
 * counts are unchanged — preserves multi-UV/skin/etc.; identity when nothing changed) or **rebuilds** the
 * whole geometry (Struct + BinMeshPLG + night colours + bounds) when a count changed. The chunk codec fixes
 * all chunk sizes. Throws when the IR geometry count no longer matches the DFF (e.g. anti-rip recovered
 * geometry); the rebuild path throws on data it can't remap (skin / multi-UV / multi-morph).
 */
export function encodeDff(source: Uint8Array, ir: MeshIR): Uint8Array {
  const file = readRw(source);
  const geometries = collectGeometries(file.chunks);
  if (geometries.length !== ir.meshes.length) {
    throw new Error(`geometry count mismatch: ${geometries.length} in DFF vs ${ir.meshes.length} in IR`);
  }
  geometries.forEach((geometry, index) => {
    const mesh = ir.meshes[index];
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (!struct?.data) {
      throw new Error(`geometry ${index} has no Struct`);
    }
    const view = new DataView(struct.data.buffer, struct.data.byteOffset, struct.data.byteLength);
    const numTriangles = view.getUint32(4, true);
    const numVertices = view.getUint32(8, true);
    if (mesh.positions.length === numVertices * 3 && mesh.triangles.length === numTriangles) {
      struct.data = applyMeshToStruct(struct.data, mesh);
    } else {
      rebuildGeometry(geometry, mesh);
    }
    addNightColorsIfMissing(geometry, mesh); // synthesized night sets (plan 013); no-op otherwise
  });

  return writeRw(file);
}
