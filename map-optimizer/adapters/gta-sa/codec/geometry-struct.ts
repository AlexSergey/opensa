import type { SubMesh } from '../../../core/ir';

/**
 * Overwrite a Geometry Struct's vertex-attribute bytes from a {@link SubMesh}, **in place** (same vertex /
 * triangle counts, so the Struct keeps its exact byte length and no sizes shift). This is the topology-
 * preserving write path — enough for the first transform class (e.g. recomputed normals). A vertex/triangle
 * count change is a topology edit the in-place patcher can't express and **throws** (the full re-encoder is a
 * later task).
 *
 * Struct layout (non-native RpGeometry, the SA on-disk form — mirrors `src/.../dff.ts`): `flags u16,
 * numUVLayers u8, native u8, numTriangles u32, numVertices u32, numMorphTargets u32`, then (if PRELIT) RGBA
 * ×V, UV layers (uv f32 ×2×V each), triangles (u16 ×4 each), then per morph target `bsphere(4 f32),
 * hasVertices u32, hasNormals u32, [positions f32 ×3×V], [normals f32 ×3×V]`.
 */

const PRELIT_FLAG = 0x0008;

export function patchGeometryStruct(struct: Uint8Array, mesh: SubMesh): Uint8Array {
  const view = new DataView(struct.buffer, struct.byteOffset, struct.byteLength);
  const flags = view.getUint16(0, true);
  const numUVLayers = struct[2];
  const numTriangles = view.getUint32(4, true);
  const numVertices = view.getUint32(8, true);
  const numMorphTargets = view.getUint32(12, true);

  if (mesh.positions.length !== numVertices * 3) {
    throw new Error(
      `topology change unsupported: "${mesh.name}" has ${mesh.positions.length / 3} vertices, struct has ${numVertices}`,
    );
  }

  const out = struct.slice();
  const outView = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let offset = 16;

  if (flags & PRELIT_FLAG) {
    if (mesh.prelitColors?.length === numVertices * 4) {
      out.set(mesh.prelitColors, offset);
    }
    offset += numVertices * 4;
  }

  for (let layer = 0; layer < numUVLayers; layer += 1) {
    if (layer === 0 && mesh.uvs?.length === numVertices * 2) {
      writeFloats(outView, offset, mesh.uvs);
    }
    offset += numVertices * 2 * 4;
  }

  offset += numTriangles * 8; // triangles are topology — preserved as-is

  for (let target = 0; target < numMorphTargets; target += 1) {
    offset += 16; // bounding sphere
    const hasVertices = view.getUint32(offset, true);
    const hasNormals = view.getUint32(offset + 4, true);
    offset += 8;
    if (hasVertices) {
      if (target === 0) {
        writeFloats(outView, offset, mesh.positions);
      }
      offset += numVertices * 3 * 4;
    }
    if (hasNormals) {
      if (target === 0 && mesh.normals?.length === numVertices * 3) {
        writeFloats(outView, offset, mesh.normals);
      }
      offset += numVertices * 3 * 4;
    }
  }

  return out;
}

function writeFloats(view: DataView, offset: number, values: Float32Array): void {
  for (let i = 0; i < values.length; i += 1) {
    view.setFloat32(offset + i * 4, values[i], true);
  }
}
