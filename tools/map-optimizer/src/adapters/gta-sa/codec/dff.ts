import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import { readRw, RW_STRUCT, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

import type { MeshIR } from '../../../core/ir';

import { addNightColorsIfMissing, applyMeshToStruct, rebuildGeometry } from './geometry-rebuild';

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
    // Decide attribute-overlay vs full rebuild by the actual **topology**, not just counts. A plain count match
    // is unsafe: topology-changing plugins (weld/prune + smooth-normals) can land the vertex/triangle counts
    // back on the source's while the triangle indices differ — overlaying then writes stale indices and shatters
    // the model. Only when the triangles are byte-for-byte identical is the overlay path (which preserves
    // multi-UV/skin) correct.
    if (sameTopology(decodeGeometryStruct(struct.data), mesh)) {
      struct.data = applyMeshToStruct(struct.data, mesh);
    } else {
      rebuildGeometry(geometry, mesh);
    }
    addNightColorsIfMissing(geometry, mesh); // synthesized night sets (plan 013); no-op otherwise
  });

  return writeRw(file);
}

/** True when the Struct's vertex count + triangle indices exactly match the mesh (an attribute-only edit). */
function sameTopology(struct: GeometryStruct, mesh: MeshIR['meshes'][number]): boolean {
  if (struct.numVertices !== mesh.positions.length / 3 || struct.triangles.length !== mesh.triangles.length) {
    return false;
  }
  for (let i = 0; i < struct.triangles.length; i += 1) {
    const a = struct.triangles[i];
    const b = mesh.triangles[i];
    if (a.a !== b.a || a.b !== b.b || a.c !== b.c) {
      return false;
    }
  }

  return true;
}
