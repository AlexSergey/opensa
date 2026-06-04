import { BinaryStream } from './binary-stream';
import { ChunkHeader, findChild, forEachChild, readChunkHeader, readStringChunk } from './chunks';
import { GeometryFlag, RwSection } from './constants';
import { RWAtomic, RWClump, RWFrame, RWGeometry, RWMaterial, RWTriangle } from './types';

/**
 * Parse a RenderWare Clump (.dff) into a renderer-agnostic RWClump.
 *
 * Handles the canonical GTA SA structure: FrameList, GeometryList (positions,
 * prelit colors, UV layers, triangles, morph-target geometry, materials with
 * texture names) and Atomics. Skinning, multi-morph and BinMeshPLG splits are
 * intentionally out of scope (see plan); triangles carry per-face material
 * indices which the adapter groups by.
 */
export function parseDff(buffer: ArrayBuffer): RWClump {
  const stream = new BinaryStream(buffer);
  const clumpHeader = readChunkHeader(stream);
  if (clumpHeader.type !== RwSection.CLUMP) {
    throw new Error(`Not a DFF: expected Clump (0x10), got 0x${clumpHeader.type.toString(16)}`);
  }

  let frames: RWFrame[] = [];
  let geometries: RWGeometry[] = [];
  const atomics: RWAtomic[] = [];

  forEachChild(stream, clumpHeader.dataStart, clumpHeader.end, (child) => {
    switch (child.type) {
      case RwSection.FRAME_LIST:
        frames = parseFrameList(stream, child);
        break;
      case RwSection.GEOMETRY_LIST:
        geometries = parseGeometryList(stream, child);
        break;
      case RwSection.ATOMIC:
        atomics.push(parseAtomic(stream, child));
        break;
      default:
        break;
    }
  });

  return { frames, geometries, atomics };
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
      stream.f32(), stream.f32(), stream.f32(),
      stream.f32(), stream.f32(), stream.f32(),
      stream.f32(), stream.f32(), stream.f32(),
    ];
    const position = stream.vec3();
    const parentIndex = stream.i32();
    stream.skip(4); // matrix creation flags
    frames.push({ rotation, position, parentIndex, name: '' });
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

function parseGeometryList(stream: BinaryStream, header: ChunkHeader): RWGeometry[] {
  const geometries: RWGeometry[] = [];
  forEachChild(stream, header.dataStart, header.end, (child) => {
    if (child.type === RwSection.GEOMETRY) {
      geometries.push(parseGeometry(stream, child));
    }
  });
  return geometries;
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

  let prelitColors: Uint8Array | null = null;
  if (flags & GeometryFlag.PRELIT) {
    prelitColors = stream.bytes(numVertices * 4);
  }

  const uvLayers: Float32Array[] = [];
  for (let layer = 0; layer < numUVLayers; layer += 1) {
    const uv = new Float32Array(numVertices * 2);
    for (let i = 0; i < uv.length; i += 1) {
      uv[i] = stream.f32();
    }
    uvLayers.push(uv);
  }

  const triangles: RWTriangle[] = [];
  for (let i = 0; i < numTriangles; i += 1) {
    // RW packs faces as [vertex2, vertex1, materialIndex, vertex3].
    const b = stream.u16();
    const a = stream.u16();
    const materialIndex = stream.u16();
    const c = stream.u16();
    triangles.push({ a, b, c, materialIndex });
  }

  let positions = new Float32Array(numVertices * 3);
  let normals: Float32Array | null = null;
  for (let target = 0; target < numMorphTargets; target += 1) {
    stream.skip(16); // bounding sphere (x, y, z, radius)
    const hasVertices = stream.u32();
    const hasNormals = stream.u32();
    if (hasVertices) {
      const verts = new Float32Array(numVertices * 3);
      for (let i = 0; i < verts.length; i += 1) {
        verts[i] = stream.f32();
      }
      if (target === 0) {
        positions = verts;
      }
    }
    if (hasNormals) {
      const norms = new Float32Array(numVertices * 3);
      for (let i = 0; i < norms.length; i += 1) {
        norms[i] = stream.f32();
      }
      if (target === 0) {
        normals = norms;
      }
    }
  }

  const matList = findChild(stream, header.dataStart, header.end, RwSection.MATERIAL_LIST);
  const materials = matList ? parseMaterialList(stream, matList) : [];

  return { flags, numUVLayers, positions, normals, prelitColors, uvLayers, triangles, materials };
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

  return { color, textured, texture };
}

function parseTexture(stream: BinaryStream, header: ChunkHeader): { name: string; maskName: string } {
  // Texture chunk: Struct (filter flags), then two String chunks (name, mask).
  const names: string[] = [];
  forEachChild(stream, header.dataStart, header.end, (child) => {
    if (child.type === RwSection.STRING) {
      names.push(readStringChunk(stream, child));
    }
  });
  return { name: names[0] ?? '', maskName: names[1] ?? '' };
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
