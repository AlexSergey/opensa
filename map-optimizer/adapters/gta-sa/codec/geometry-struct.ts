import type { SubMesh } from '../../../core/ir';

/**
 * Faithful RpGeometry **Struct** codec (decode ⇄ encode) — the re-encoder's core (plan 003). Rebuilds the
 * Struct body from a decoded model, so layout changes the in-place patcher couldn't express (notably **adding
 * a normals block**) become possible, while `encode(decode(bytes))` stays byte-exact (the correctness gate).
 *
 * Struct layout (non-native RpGeometry, the SA on-disk form — mirrors `src/.../dff.ts`): `flags u16,
 * numUVLayers u8, native u8, numTriangles u32, numVertices u32, numMorphTargets u32`, then (if PRELIT) RGBA
 * ×V, UV layers (uv f32 ×2×V each), triangles (`vertex2, vertex1, material, vertex3` as u16), then per morph
 * target `bounds(4 f32), hasVertices u32, hasNormals u32, [positions f32 ×3×V], [normals f32 ×3×V]`.
 */

const PRELIT_FLAG = 0x0008;
const NORMALS_FLAG = 0x0010;

/** The decoded RpGeometry Struct — everything the Struct body holds, ready to re-encode. */
export interface GeometryStruct {
  flags: number;
  morphs: MorphTarget[];
  native: number;
  numTriangles: number;
  numVertices: number;
  prelit: null | Uint8Array;
  triangles: StructTriangle[];
  uvLayers: Float32Array[];
}

/** One morph target: bounding sphere + optional position/normal arrays (`null` ⇒ the flag is 0). */
interface MorphTarget {
  bounds: [number, number, number, number];
  normals: Float32Array | null;
  positions: Float32Array | null;
}

/** One face: vertex indices + material slot (stored RW-packed on the wire). */
interface StructTriangle {
  a: number;
  b: number;
  c: number;
  material: number;
}

/** Overlay a {@link SubMesh}'s attributes onto a Struct's bytes and re-encode. Adds a normals block when the
 *  mesh has normals and the Struct didn't. Throws on a vertex-count change (a topology edit — see plan 004). */
export function applyMeshToStruct(structBytes: Uint8Array, mesh: SubMesh): Uint8Array {
  const struct = decodeGeometryStruct(structBytes);
  if (mesh.positions.length !== struct.numVertices * 3) {
    throw new Error(
      `topology change unsupported: "${mesh.name}" has ${mesh.positions.length / 3} vertices, struct has ${struct.numVertices}`,
    );
  }

  const morph = struct.morphs[0];
  if (morph?.positions) {
    morph.positions = mesh.positions;
  }
  if (mesh.normals && morph) {
    morph.normals = mesh.normals; // replaces, or ADDS the normals block when it was absent
    struct.flags |= NORMALS_FLAG;
  }
  if (struct.prelit && mesh.prelitColors?.length === struct.numVertices * 4) {
    struct.prelit = mesh.prelitColors;
  }
  if (struct.uvLayers[0] && mesh.uvs?.length === struct.numVertices * 2) {
    struct.uvLayers[0] = mesh.uvs;
  }

  return encodeGeometryStruct(struct);
}

export function decodeGeometryStruct(bytes: Uint8Array): GeometryStruct {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = view.getUint16(0, true);
  const numUVLayers = bytes[2];
  const native = bytes[3];
  const numTriangles = view.getUint32(4, true);
  const numVertices = view.getUint32(8, true);
  const numMorphTargets = view.getUint32(12, true);
  let offset = 16;

  let prelit: null | Uint8Array = null;
  if (flags & PRELIT_FLAG) {
    prelit = bytes.slice(offset, offset + numVertices * 4);
    offset += numVertices * 4;
  }

  const uvLayers: Float32Array[] = [];
  for (let layer = 0; layer < numUVLayers; layer += 1) {
    uvLayers.push(readFloats(view, offset, numVertices * 2));
    offset += numVertices * 2 * 4;
  }

  const triangles: StructTriangle[] = [];
  for (let i = 0; i < numTriangles; i += 1) {
    triangles.push({
      a: view.getUint16(offset + 2, true),
      b: view.getUint16(offset, true),
      c: view.getUint16(offset + 6, true),
      material: view.getUint16(offset + 4, true),
    });
    offset += 8;
  }

  const morphs: MorphTarget[] = [];
  for (let i = 0; i < numMorphTargets; i += 1) {
    const bounds: [number, number, number, number] = [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true),
    ];
    const hasVertices = view.getUint32(offset + 16, true);
    const hasNormals = view.getUint32(offset + 20, true);
    offset += 24;
    let positions: Float32Array | null = null;
    let normals: Float32Array | null = null;
    if (hasVertices) {
      positions = readFloats(view, offset, numVertices * 3);
      offset += numVertices * 3 * 4;
    }
    if (hasNormals) {
      normals = readFloats(view, offset, numVertices * 3);
      offset += numVertices * 3 * 4;
    }
    morphs.push({ bounds, normals, positions });
  }

  return { flags, morphs, native, numTriangles, numVertices, prelit, triangles, uvLayers };
}

export function encodeGeometryStruct(struct: GeometryStruct): Uint8Array {
  const vertexFloats = struct.numVertices * 3 * 4;
  let size = 16;
  if (struct.flags & PRELIT_FLAG) {
    size += struct.numVertices * 4;
  }
  size += struct.uvLayers.length * struct.numVertices * 2 * 4;
  size += struct.numTriangles * 8;
  for (const morph of struct.morphs) {
    size += 24 + (morph.positions ? vertexFloats : 0) + (morph.normals ? vertexFloats : 0);
  }

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint16(0, struct.flags, true);
  out[2] = struct.uvLayers.length;
  out[3] = struct.native;
  view.setUint32(4, struct.numTriangles, true);
  view.setUint32(8, struct.numVertices, true);
  view.setUint32(12, struct.morphs.length, true);
  let offset = 16;

  if (struct.flags & PRELIT_FLAG && struct.prelit) {
    out.set(struct.prelit, offset);
    offset += struct.numVertices * 4;
  }
  for (const layer of struct.uvLayers) {
    offset = writeFloats(view, offset, layer);
  }
  for (const triangle of struct.triangles) {
    view.setUint16(offset, triangle.b, true);
    view.setUint16(offset + 2, triangle.a, true);
    view.setUint16(offset + 4, triangle.material, true);
    view.setUint16(offset + 6, triangle.c, true);
    offset += 8;
  }
  for (const morph of struct.morphs) {
    view.setFloat32(offset, morph.bounds[0], true);
    view.setFloat32(offset + 4, morph.bounds[1], true);
    view.setFloat32(offset + 8, morph.bounds[2], true);
    view.setFloat32(offset + 12, morph.bounds[3], true);
    view.setUint32(offset + 16, morph.positions ? 1 : 0, true);
    view.setUint32(offset + 20, morph.normals ? 1 : 0, true);
    offset += 24;
    if (morph.positions) {
      offset = writeFloats(view, offset, morph.positions);
    }
    if (morph.normals) {
      offset = writeFloats(view, offset, morph.normals);
    }
  }

  return out;
}

function readFloats(view: DataView, offset: number, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = view.getFloat32(offset + i * 4, true);
  }

  return out;
}

function writeFloats(view: DataView, offset: number, values: Float32Array): number {
  for (let i = 0; i < values.length; i += 1) {
    view.setFloat32(offset + i * 4, values[i], true);
  }

  return offset + values.length * 4;
}
