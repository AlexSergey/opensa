import type { ChunkHeader } from './chunks';
import type { RWAtomic, RWClump, RWFrame, RWGeometry, RWMaterial, RWSkin, RWTriangle } from './types';

import { BinaryStream } from './binary-stream';
import { findChild, forEachChild, readChunkHeader, readStringChunk } from './chunks';
import { GeometryFlag, RwSection } from './constants';

/** RenderWare chunk header size (type + size + libraryVersion, 3 × u32). */
const CHUNK_HEADER_BYTES = 12;

/**
 * Parse a RenderWare Clump (.dff) into a renderer-agnostic RWClump.
 *
 * Handles the canonical GTA SA structure: FrameList, GeometryList (positions,
 * prelit colors, UV layers, triangles, morph-target geometry, materials with
 * texture names, and the Skin plugin for skinned character meshes) and Atomics.
 * Multi-morph and BinMeshPLG splits are intentionally out of scope (see plan);
 * triangles carry per-face material indices which the adapter groups by.
 */
export function parseDff(buffer: ArrayBuffer): RWClump {
  const stream = new BinaryStream(buffer);
  // Some DFFs (UV-animated — waterfalls, scrolling signs) begin with a UVAnimDict
  // (0x2B) chunk before the Clump; skip any leading non-Clump chunks to find it.
  let clumpHeader = readChunkHeader(stream);
  while (clumpHeader.type !== RwSection.CLUMP) {
    stream.seek(clumpHeader.end);
    if (stream.remaining < CHUNK_HEADER_BYTES) {
      throw new Error('Not a DFF: no Clump (0x10) chunk found');
    }
    clumpHeader = readChunkHeader(stream);
  }

  let frames: RWFrame[] = [];
  let geometries: RWGeometry[] = [];
  const atomics: RWAtomic[] = [];

  forEachChild(stream, clumpHeader.dataStart, clumpHeader.end, (child) => {
    switch (child.type) {
      case RwSection.ATOMIC:
        atomics.push(parseAtomic(stream, child));
        break;
      case RwSection.FRAME_LIST:
        frames = parseFrameList(stream, child);
        break;
      case RwSection.GEOMETRY_LIST:
        geometries = parseGeometryList(stream, child);
        break;
      default:
        break;
    }
  });

  return { atomics, frames, geometries };
}

function parseAtomic(stream: BinaryStream, header: ChunkHeader): RWAtomic {
  const struct = findChild(stream, header.dataStart, header.end, RwSection.STRUCT);
  if (!struct) {
    throw new Error('Atomic missing Struct');
  }
  stream.seek(struct.dataStart);
  const frameIndex = stream.u32();
  const geometryIndex = stream.u32();

  return { frameIndex, geometryIndex };
}

function parseFrameList(stream: BinaryStream, header: ChunkHeader): RWFrame[] {
  const struct = findChild(stream, header.dataStart, header.end, RwSection.STRUCT);
  if (!struct) {
    throw new Error('FrameList missing Struct');
  }

  stream.seek(struct.dataStart);
  const numFrames = stream.u32();
  const frames: RWFrame[] = [];
  for (let i = 0; i < numFrames; i += 1) {
    const rotation = [
      stream.f32(),
      stream.f32(),
      stream.f32(),
      stream.f32(),
      stream.f32(),
      stream.f32(),
      stream.f32(),
      stream.f32(),
      stream.f32(),
    ];
    const position = stream.vec3();
    const parentIndex = stream.i32();
    stream.skip(4); // matrix creation flags
    frames.push({ name: '', parentIndex, position, rotation });
  }

  // Frame names live in per-frame Extension chunks following the Struct.
  let frameIndex = 0;
  forEachChild(stream, header.dataStart, header.end, (child) => {
    if (child.type !== RwSection.EXTENSION) {
      return;
    }
    const nameChunk = findChild(stream, child.dataStart, child.end, RwSection.FRAME);
    if (nameChunk && frameIndex < frames.length) {
      stream.seek(nameChunk.dataStart);
      frames[frameIndex].name = stream.string(nameChunk.size);
    }
    frameIndex += 1;
  });

  return frames;
}

function parseGeometry(stream: BinaryStream, header: ChunkHeader): RWGeometry {
  const struct = findChild(stream, header.dataStart, header.end, RwSection.STRUCT);
  if (!struct) {
    throw new Error('Geometry missing Struct');
  }

  stream.seek(struct.dataStart);
  const flags = stream.u16();
  const numUVLayers = stream.u8();
  stream.u8(); // native flag (unused: SA stores non-native data here)
  const numTriangles = stream.u32();
  const numVertices = stream.u32();
  const numMorphTargets = stream.u32();

  const prelitColors = flags & GeometryFlag.PRELIT ? stream.bytes(numVertices * 4) : null;
  const uvLayers = readUVLayers(stream, numUVLayers, numVertices);
  const triangles = readTriangles(stream, numTriangles);
  const { normals, positions } = readMorphTargets(stream, numMorphTargets, numVertices);

  const matList = findChild(stream, header.dataStart, header.end, RwSection.MATERIAL_LIST);
  const materials = matList ? parseMaterialList(stream, matList) : [];
  const skin = parseSkinExtension(stream, header, numVertices);

  return { flags, materials, normals, numUVLayers, positions, prelitColors, skin, triangles, uvLayers };
}

function parseGeometryList(stream: BinaryStream, header: ChunkHeader): RWGeometry[] {
  const geometries: RWGeometry[] = [];
  forEachChild(stream, header.dataStart, header.end, (child) => {
    if (child.type === RwSection.GEOMETRY) {
      geometries.push(parseGeometry(stream, child));
    }
  });

  return geometries;
}

function parseMaterial(stream: BinaryStream, header: ChunkHeader): RWMaterial {
  const struct = findChild(stream, header.dataStart, header.end, RwSection.STRUCT);
  if (!struct) {
    throw new Error('Material missing Struct');
  }

  stream.seek(struct.dataStart);
  stream.u32(); // flags (unused)
  const color: [number, number, number, number] = [stream.u8(), stream.u8(), stream.u8(), stream.u8()];
  stream.u32(); // unused
  const textured = stream.u32() !== 0;

  let texture = null;
  const texChunk = findChild(stream, header.dataStart, header.end, RwSection.TEXTURE);
  if (texChunk) {
    texture = parseTexture(stream, texChunk);
  }

  return { color, texture, textured };
}

function parseMaterialList(stream: BinaryStream, header: ChunkHeader): RWMaterial[] {
  const materials: RWMaterial[] = [];
  forEachChild(stream, header.dataStart, header.end, (child) => {
    if (child.type === RwSection.MATERIAL) {
      materials.push(parseMaterial(stream, child));
    }
  });

  return materials;
}

/** Parse the Skin plugin from a geometry's Extension, or undefined if not skinned. */
function parseSkinExtension(stream: BinaryStream, header: ChunkHeader, numVertices: number): RWSkin | undefined {
  const extension = findChild(stream, header.dataStart, header.end, RwSection.EXTENSION);
  if (!extension) {
    return undefined;
  }
  const skinChunk = findChild(stream, extension.dataStart, extension.end, RwSection.SKIN);
  if (!skinChunk) {
    return undefined;
  }

  stream.seek(skinChunk.dataStart);
  const numBones = stream.u8();
  const numUsedBones = stream.u8();
  stream.u8(); // maxWeightsPerVertex (unused)
  stream.u8(); // padding
  const usedBones: number[] = [];
  for (let i = 0; i < numUsedBones; i += 1) {
    usedBones.push(stream.u8());
  }
  const boneIndices = stream.bytes(numVertices * 4);
  const boneWeights = readFloat32Array(stream, numVertices * 4);
  const inverseBindMatrices = readFloat32Array(stream, numBones * 16);
  // A 12-byte split trailer (boneLimit, numMeshes, numRLE) follows; not needed here.

  return { boneIndices, boneWeights, inverseBindMatrices, numBones, usedBones };
}

function parseTexture(stream: BinaryStream, header: ChunkHeader): { maskName: string; name: string } {
  // Texture chunk: Struct (filter flags), then two String chunks (name, mask).
  const names: string[] = [];
  forEachChild(stream, header.dataStart, header.end, (child) => {
    if (child.type === RwSection.STRING) {
      names.push(readStringChunk(stream, child));
    }
  });

  return { maskName: names[1] ?? '', name: names[0] ?? '' };
}

function readFloat32Array(stream: BinaryStream, count: number): Float32Array {
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = stream.f32();
  }

  return out;
}

function readMorphTargets(
  stream: BinaryStream,
  numMorphTargets: number,
  numVertices: number,
): { normals: Float32Array | null; positions: Float32Array } {
  let positions: Float32Array = new Float32Array(numVertices * 3);
  let normals: Float32Array | null = null;
  for (let target = 0; target < numMorphTargets; target += 1) {
    stream.skip(16); // bounding sphere (x, y, z, radius)
    const hasVertices = stream.u32();
    const hasNormals = stream.u32();
    if (hasVertices) {
      const verts = readFloat32Array(stream, numVertices * 3);
      if (target === 0) {
        positions = verts;
      }
    }
    if (hasNormals) {
      const norms = readFloat32Array(stream, numVertices * 3);
      if (target === 0) {
        normals = norms;
      }
    }
  }

  return { normals, positions };
}

function readTriangles(stream: BinaryStream, numTriangles: number): RWTriangle[] {
  const triangles: RWTriangle[] = [];
  for (let i = 0; i < numTriangles; i += 1) {
    // RW packs faces as [vertex2, vertex1, materialIndex, vertex3].
    const b = stream.u16();
    const a = stream.u16();
    const materialIndex = stream.u16();
    const c = stream.u16();
    triangles.push({ a, b, c, materialIndex });
  }

  return triangles;
}

function readUVLayers(stream: BinaryStream, numUVLayers: number, numVertices: number): Float32Array[] {
  const uvLayers: Float32Array[] = [];
  for (let layer = 0; layer < numUVLayers; layer += 1) {
    uvLayers.push(readFloat32Array(stream, numVertices * 2));
  }

  return uvLayers;
}
