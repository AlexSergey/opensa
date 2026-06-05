import type { ColBox, ColFace, ColModel, ColSphere, ColSurface, ColVersion } from './col-types';

import { BinaryStream } from './binary-stream';

const COL_VERSIONS: Record<string, ColVersion | undefined> = {
  COL2: 2,
  COL3: 3,
  COL4: 4,
  COLL: 1,
};

/** Section offsets are stored relative to the FourCC `size` field, i.e. body start − 4. */
const OFFSET_BASE = 4;

/** COL2+ vertices are compressed: int16 / 128 → metres. */
const VERTEX_SCALE = 128;

/**
 * Parse a GTA San Andreas COL collision library (one `.col` file) into a flat
 * list of collision models. A library is a concatenation of FourCC-tagged
 * blocks (`COLL`/`COL2`/`COL3`/`COL4`); each block is one named collision model
 * whose name matches a DFF model, used to bind collision to placed objects.
 *
 * Implements COL2/COL3/COL4 (San Andreas): bounds, spheres, boxes and the
 * collision triangle mesh. Vertices are stored compressed (int16 / 128) and
 * decompressed to model-space metres; the vertex count is derived from the face
 * indices (it is not stored). COL1 (GTA III/VC, uncompressed float vertices) is
 * skipped — it does not occur in the SA archive. Shadow mesh, cones/lines and
 * face groups are present in some models but not surfaced (not needed for
 * collision).
 */
export function parseColLibrary(buffer: ArrayBuffer): ColModel[] {
  const stream = new BinaryStream(buffer);
  const models: ColModel[] = [];

  while (stream.remaining >= 8) {
    const fourcc = stream.string(4);
    const version = COL_VERSIONS[fourcc];
    const size = stream.u32();
    if (version === undefined || size === 0 || size > stream.remaining) {
      break; // padding / terminator / truncated tail — end of library
    }
    const body = stream.bytes(size);
    if (version >= 2) {
      models.push(parseModel(body, version));
    }
    // COL1 is skipped (absent from SA; its vertex layout is uncompressed float).
  }

  return models;
}

function parseModel(body: Uint8Array, version: ColVersion): ColModel {
  const stream = new BinaryStream(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength);
  const name = stream.string(22);
  const modelId = stream.u16();

  const min = stream.vec3();
  const max = stream.vec3();
  const center = stream.vec3();
  const radius = stream.f32();

  const numSpheres = stream.u16();
  const numBoxes = stream.u16();
  const numFaces = stream.u32();
  stream.u32(); // flags (unused)
  const offsetSpheres = stream.u32() - OFFSET_BASE;
  const offsetBoxes = stream.u32() - OFFSET_BASE;
  stream.u32(); // cones/lines offset (unused)
  const offsetVertices = stream.u32() - OFFSET_BASE;
  const offsetFaces = stream.u32() - OFFSET_BASE;
  // COL3/COL4 shadow-mesh fields follow here but are not needed for collision.

  const spheres = readSpheres(stream, offsetSpheres, numSpheres);
  const boxes = readBoxes(stream, offsetBoxes, numBoxes);
  const faces = readFaces(stream, offsetFaces, numFaces);
  const vertices = readVertices(stream, offsetVertices, vertexCount(faces));

  return { bounds: { center, max, min, radius }, boxes, faces, modelId, name, spheres, version, vertices };
}

function readBoxes(stream: BinaryStream, offset: number, count: number): ColBox[] {
  const boxes: ColBox[] = [];
  if (count === 0) {
    return boxes;
  }
  stream.seek(offset);
  for (let i = 0; i < count; i += 1) {
    const min = stream.vec3();
    const max = stream.vec3();
    const surface = readSurface(stream);
    boxes.push({ max, min, surface });
  }

  return boxes;
}

function readFaces(stream: BinaryStream, offset: number, count: number): ColFace[] {
  const faces: ColFace[] = [];
  if (count === 0) {
    return faces;
  }
  stream.seek(offset);
  for (let i = 0; i < count; i += 1) {
    const a = stream.u16();
    const b = stream.u16();
    const c = stream.u16();
    const material = stream.u8();
    const light = stream.u8();
    faces.push({ a, b, c, light, material });
  }

  return faces;
}

function readSpheres(stream: BinaryStream, offset: number, count: number): ColSphere[] {
  const spheres: ColSphere[] = [];
  if (count === 0) {
    return spheres;
  }
  stream.seek(offset);
  for (let i = 0; i < count; i += 1) {
    const center = stream.vec3();
    const radius = stream.f32();
    const surface = readSurface(stream);
    spheres.push({ center, radius, surface });
  }

  return spheres;
}

function readSurface(stream: BinaryStream): ColSurface {
  const material = stream.u8();
  const flag = stream.u8();
  const brightness = stream.u8();
  const light = stream.u8();

  return { brightness, flag, light, material };
}

function readVertices(stream: BinaryStream, offset: number, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  if (count === 0) {
    return out;
  }
  stream.seek(offset);
  for (let i = 0; i < count * 3; i += 1) {
    out[i] = stream.i16() / VERTEX_SCALE;
  }

  return out;
}

function vertexCount(faces: ColFace[]): number {
  let max = -1;
  for (const face of faces) {
    max = Math.max(max, face.a, face.b, face.c);
  }

  return max + 1;
}
