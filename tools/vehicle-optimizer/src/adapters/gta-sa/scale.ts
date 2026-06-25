import { readRw, RW_STRUCT, type RwChunk, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

/**
 * Uniformly scale a vehicle DFF by `factor` (plan 002): every geometry's vertex positions + bounding sphere, and
 * every frame's translation (the dummy rig). Rotations, topology, UVs, prelit, materials are untouched. Because
 * geometry is scaled about each part's local origin **and** the frame translations are scaled by the same factor,
 * the whole vehicle scales about its root — parts stay aligned, so doors/wheels don't drift. Reuses
 * map-optimizer's faithful RW chunk + geometry-struct codec, so the output is standard RenderWare.
 *
 * Scaling about the origin sinks the vehicle: the resting bottom moves to `bottom*factor`, so a bigger model's
 * wheels dig into the asphalt (and a smaller one floats). We compensate by lifting the **whole** vehicle —
 * visual parts (via the root frame) and collision — by `bottom*(1-factor)` along Z, restoring the pre-scale
 * ground contact. `bottom` is the embedded collision's min-Z (the part that rests on the ground); works for
 * shrink (`factor < 1` → shift down) too.
 */
export function scaleDff(bytes: Uint8Array, factor: number): Uint8Array {
  const file = readRw(bytes);
  const bottomZ = collisionBottom(file); // captured before scaling so the lift can restore it
  scalePass(file, factor);
  if (bottomZ !== null && factor !== 1) {
    liftPass(file, bottomZ * (1 - factor));
  }

  return writeRw(file);
}

/** Pre-scale resting bottom (the embedded collision's min-Z), or null when the DFF carries no collision. */
function collisionBottom(file: ReturnType<typeof readRw>): null | number {
  for (const chunk of walk(file.chunks)) {
    if (chunk.type === RW_COLLISION && chunk.data && isColLeaf(chunk.data)) {
      return collisionMinZ(chunk.data);
    }
  }

  return null;
}

/** Lift the whole vehicle by `liftZ` along Z — visual parts via the root frame, plus the collision. */
function liftPass(file: ReturnType<typeof readRw>, liftZ: number): void {
  for (const chunk of walk(file.chunks)) {
    if (chunk.type === RW_FRAME_LIST && chunk.data) {
      liftRootFrames(chunk.data, liftZ);
    } else if (chunk.type === RW_COLLISION && chunk.data) {
      liftEmbeddedCollision(chunk.data, liftZ);
    }
  }
}

/** Scale geometry, the frame rig and the embedded collision by `factor`. */
function scalePass(file: ReturnType<typeof readRw>, factor: number): void {
  for (const chunk of walk(file.chunks)) {
    if (chunk.type === RW_FRAME_LIST && chunk.data) {
      scaleFrameList(chunk.data, factor);
    } else if (chunk.type === RW_COLLISION && chunk.data) {
      scaleEmbeddedCollision(chunk.data, factor);
    }
  }
  for (const geometry of collectGeometries(file.chunks)) {
    const struct = geometry.children?.find((child) => child.type === RW_STRUCT && child.data);
    if (struct?.data) {
      struct.data = scaleGeometryStruct(struct.data, factor);
    }
  }
}

/** RenderWare Frame List section id (a leaf in the codec — scaled in place). */
const RW_FRAME_LIST = 0x0e;

/** Frame record: 9-float rotation (36) + 3-float position (12) + parentIndex (4) + matrix flags (4) = 56 bytes. */
const FRAME_RECORD_BYTES = 56;
const FRAME_POSITION_OFFSET = 36; // within a record, after the rotation matrix
const FRAME_PARENT_OFFSET = 48; // parentIndex i32, after the 12-byte position
/** Z is the 3rd component of a vec3 — the GTA SA vehicle up-axis (verified: height is the smallest span). */
const VERTICAL_OFFSET = 8;

/**
 * Lift only the **root** frames' Z translation (parentIndex < 0) by `liftZ`; child frames are relative, so the
 * whole visual hierarchy rides up with the root. Mirrors {@link scaleFrameList}'s record layout.
 */
export function liftRootFrames(data: Uint8Array, liftZ: number): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numFrames = view.getUint32(12, true);
  const recordsStart = 16;
  for (let i = 0; i < numFrames; i += 1) {
    const base = recordsStart + i * FRAME_RECORD_BYTES;
    if (view.getInt32(base + FRAME_PARENT_OFFSET, true) < 0) {
      const at = base + FRAME_POSITION_OFFSET + VERTICAL_OFFSET;
      view.setFloat32(at, view.getFloat32(at, true) + liftZ, true);
    }
  }
}

/**
 * Scale every frame's translation in a Frame List leaf. The leaf body is the inner `Struct` chunk (12-byte
 * header, then `numFrames` u32, then the 56-byte records) followed by per-frame Extension chunks (names/HAnim —
 * untouched).
 */
export function scaleFrameList(data: Uint8Array, factor: number): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const numFrames = view.getUint32(12, true); // after the inner Struct chunk's 12-byte header
  const recordsStart = 16; // 12 (Struct header) + 4 (numFrames)
  for (let i = 0; i < numFrames; i += 1) {
    const at = recordsStart + i * FRAME_RECORD_BYTES + FRAME_POSITION_OFFSET;
    view.setFloat32(at, view.getFloat32(at, true) * factor, true);
    view.setFloat32(at + 4, view.getFloat32(at + 4, true) * factor, true);
    view.setFloat32(at + 8, view.getFloat32(at + 8, true) * factor, true);
  }
}

/** RenderWare embedded-collision section id (0x253f2fa) — a leaf wrapping a COL2/3/4 model. */
const RW_COLLISION = 0x253f2fa;
const COL_VERSIONS = new Set(['COL2', 'COL3', 'COL4']);

/**
 * Scale the embedded vehicle collision **in place** (plan 002): the COLLISION leaf's data is a COL library
 * `[FourCC][size][body]`. We scale only the numeric geometry — bounding box/sphere, sphere + box primitives, and
 * the int16-compressed collision vertices — leaving faces, surfaces, structure and the (cosmetic) shadow mesh
 * byte-identical. Same length, so the chunk/DFF layout is undisturbed. COL2/3/4 share this header up to the
 * face offset; COL1 (not used by SA) is skipped.
 */
export function scaleEmbeddedCollision(data: Uint8Array, factor: number): void {
  if (!isColLeaf(data)) {
    return; // unknown/absent collision — leave untouched
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const body = 8; // after FourCC (4) + size (4)
  const scaleF32 = (offset: number): void => {
    view.setFloat32(offset, view.getFloat32(offset, true) * factor, true);
  };
  const scaleVec3 = (offset: number): void => {
    scaleF32(offset);
    scaleF32(offset + 4);
    scaleF32(offset + 8);
  };

  // Bounds: min(24) max(36) center(48) vec3 + radius(60).
  scaleVec3(body + 24);
  scaleVec3(body + 36);
  scaleVec3(body + 48);
  scaleF32(body + 60);

  const numSpheres = view.getUint16(body + 64, true);
  const numBoxes = view.getUint16(body + 66, true);
  const numFaces = view.getUint32(body + 68, true);
  const offsetSpheres = body + view.getUint32(body + 76, true) - COL_OFFSET_BASE;
  const offsetBoxes = body + view.getUint32(body + 80, true) - COL_OFFSET_BASE;
  const offsetVertices = body + view.getUint32(body + 88, true) - COL_OFFSET_BASE;
  const offsetFaces = body + view.getUint32(body + 92, true) - COL_OFFSET_BASE;

  for (let i = 0; i < numSpheres; i += 1) {
    const at = offsetSpheres + i * 20; // centre vec3 (12) + radius f32 (4) + surface (4)
    scaleVec3(at);
    scaleF32(at + 12);
  }
  for (let i = 0; i < numBoxes; i += 1) {
    const at = offsetBoxes + i * 28; // min vec3 (12) + max vec3 (12) + surface (4)
    scaleVec3(at);
    scaleVec3(at + 12);
  }

  // Vertex count isn't stored — it's the max face index + 1 (each face: a,b,c u16 + material,light u8).
  let maxIndex = -1;
  for (let i = 0; i < numFaces; i += 1) {
    const at = offsetFaces + i * 8;
    maxIndex = Math.max(maxIndex, view.getUint16(at, true), view.getUint16(at + 2, true), view.getUint16(at + 4, true));
  }
  for (let i = 0; i < (maxIndex + 1) * 3; i += 1) {
    const at = offsetVertices + i * 2; // int16 / 128 → metres
    const scaled = Math.round(view.getInt16(at, true) * factor);
    view.setInt16(at, Math.max(-32768, Math.min(32767, scaled)), true);
  }
}

/** The collision's bounding-box min-Z (the resting bottom): body(8) + min vec3(24) + Z(8). */
function collisionMinZ(data: Uint8Array): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat32(8 + 24 + VERTICAL_OFFSET, true);
}

/** True when the leaf begins with a COL2/3/4 FourCC. */
function isColLeaf(data: Uint8Array): boolean {
  return COL_VERSIONS.has(String.fromCharCode(data[0], data[1], data[2], data[3]));
}

/** COL section offsets are stored relative to the FourCC `size` field (body start − 4). */
const COL_OFFSET_BASE = 4;
/** Compressed collision vertices: metres × 128 → int16. */
const COL_VERTEX_SCALE = 128;

/**
 * Lift the embedded collision **in place** by `liftZ` metres along Z — bounding box/sphere, sphere + box
 * primitives and the int16 vertices — to match the visual lift after a scale. Only Z is touched; same byte
 * layout as {@link scaleEmbeddedCollision}, so the chunk size is undisturbed.
 */
export function liftEmbeddedCollision(data: Uint8Array, liftZ: number): void {
  if (!isColLeaf(data)) {
    return;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const body = 8;
  const liftF32 = (offset: number): void => {
    view.setFloat32(offset, view.getFloat32(offset, true) + liftZ, true);
  };

  // Bounds min(24) max(36) center(48) — Z component of each vec3.
  liftF32(body + 24 + VERTICAL_OFFSET);
  liftF32(body + 36 + VERTICAL_OFFSET);
  liftF32(body + 48 + VERTICAL_OFFSET);

  const numSpheres = view.getUint16(body + 64, true);
  const numBoxes = view.getUint16(body + 66, true);
  const numFaces = view.getUint32(body + 68, true);
  const offsetSpheres = body + view.getUint32(body + 76, true) - COL_OFFSET_BASE;
  const offsetBoxes = body + view.getUint32(body + 80, true) - COL_OFFSET_BASE;
  const offsetVertices = body + view.getUint32(body + 88, true) - COL_OFFSET_BASE;
  const offsetFaces = body + view.getUint32(body + 92, true) - COL_OFFSET_BASE;

  for (let i = 0; i < numSpheres; i += 1) {
    liftF32(offsetSpheres + i * 20 + VERTICAL_OFFSET); // centre.z (centre vec3 + radius + surface)
  }
  for (let i = 0; i < numBoxes; i += 1) {
    liftF32(offsetBoxes + i * 28 + VERTICAL_OFFSET); // min.z
    liftF32(offsetBoxes + i * 28 + 12 + VERTICAL_OFFSET); // max.z
  }

  let maxIndex = -1;
  for (let i = 0; i < numFaces; i += 1) {
    const at = offsetFaces + i * 8;
    maxIndex = Math.max(maxIndex, view.getUint16(at, true), view.getUint16(at + 2, true), view.getUint16(at + 4, true));
  }
  const dz = Math.round(liftZ * COL_VERTEX_SCALE);
  for (let i = 0; i <= maxIndex; i += 1) {
    const at = offsetVertices + i * 6 + 4; // vertex i: x,y,z int16 — z at +4
    const lifted = view.getInt16(at, true) + dz;
    view.setInt16(at, Math.max(-32768, Math.min(32767, lifted)), true);
  }
}

/** Decode a Geometry Struct, scale each morph's positions + bounding sphere, re-encode (topology preserved). */
export function scaleGeometryStruct(structData: Uint8Array, factor: number): Uint8Array {
  const struct = decodeGeometryStruct(structData);
  for (const morph of struct.morphs) {
    if (morph.positions) {
      for (let i = 0; i < morph.positions.length; i += 1) {
        morph.positions[i] *= factor;
      }
    }
    // Uniform scale about the origin scales the bounding sphere centre + radius by the same factor.
    morph.bounds = [
      morph.bounds[0] * factor,
      morph.bounds[1] * factor,
      morph.bounds[2] * factor,
      morph.bounds[3] * factor,
    ];
  }

  return encodeGeometryStruct(struct);
}

/** Yield every chunk in the tree (containers + leaves). */
function* walk(chunks: readonly RwChunk[]): Generator<RwChunk> {
  for (const chunk of chunks) {
    yield chunk;
    if (chunk.children) {
      yield* walk(chunk.children);
    }
  }
}
