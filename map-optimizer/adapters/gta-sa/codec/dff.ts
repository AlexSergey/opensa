import type { MeshIR } from '../../../core/ir';
import type { RwChunk } from './chunk';

import { readRw, RW_CLUMP, RW_GEOMETRY, RW_GEOMETRY_LIST, RW_STRUCT, writeRw } from './chunk';
import { patchGeometryStruct } from './geometry-struct';

/**
 * Serialize a (possibly edited) {@link MeshIR} back to DFF bytes. Reads the source into a faithful chunk
 * tree, overwrites each Geometry Struct's vertex attributes from the matching IR sub-mesh (in place — see
 * {@link patchGeometryStruct}), and re-emits. Identity when the IR is unchanged (the attribute bytes round-
 * trip), so it doubles as the writer's correctness gate. Throws when the IR's geometry count no longer matches
 * the DFF (e.g. anti-rip recovered geometry, or a topology-changing plugin) — those need the full re-encoder.
 */
export function encodeDff(source: Uint8Array, ir: MeshIR): Uint8Array {
  const file = readRw(source);
  const structs = collectGeometryStructs(file.chunks);
  if (structs.length !== ir.meshes.length) {
    throw new Error(`geometry count mismatch: ${structs.length} in DFF vs ${ir.meshes.length} in IR`);
  }
  structs.forEach((struct, index) => {
    struct.data = patchGeometryStruct(struct.data ?? new Uint8Array(0), ir.meshes[index]);
  });

  return writeRw(file);
}

/** The Struct leaf of every Geometry, in document order (matches the IR's `meshes` order). */
function collectGeometryStructs(chunks: readonly RwChunk[]): RwChunk[] {
  const structs: RwChunk[] = [];
  for (const clump of chunks) {
    if (clump.type !== RW_CLUMP) {
      continue;
    }
    for (const list of clump.children ?? []) {
      if (list.type !== RW_GEOMETRY_LIST) {
        continue;
      }
      for (const geometry of list.children ?? []) {
        if (geometry.type !== RW_GEOMETRY) {
          continue;
        }
        const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
        if (struct) {
          structs.push(struct);
        }
      }
    }
  }

  return structs;
}
