import type { ChunkHeader } from './chunks';
import type {
  RWAtomic,
  RWClump,
  RWFrame,
  RWGeometry,
  RWLight2d,
  RWMaterial,
  RWMaterialEffects,
  RWSkin,
  RWTriangle,
} from './types';

import { BinaryStream } from './binary-stream';
import { findChild, forEachChild, readChunkHeader, readStringChunk } from './chunks';
import { GeometryFlag, MatFxEffect, RwSection } from './constants';

/** RenderWare chunk header size (type + size + libraryVersion, 3 × u32). */
const CHUNK_HEADER_BYTES = 12;
/** 2d-effect entry type for a light/corona (vs particle, ped attractor, …). */
const LIGHT_EFFECT = 0;

/**
 * Parse a RenderWare Clump (.dff) into a renderer-agnostic RWClump.
 *
 * Handles the canonical GTA SA structure: FrameList, GeometryList (positions,
 * prelit colors, UV layers, triangles, morph-target geometry, materials with
 * texture names, and the Skin plugin for skinned character meshes) and Atomics.
 * Triangles carry per-face material indices which the adapter groups by; when an
 * exporter zeroes them, they are recovered from the BinMeshPLG split. (Multi-morph
 * is still out of scope — see plan.)
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

/**
 * Recover per-face material indices from the geometry's BinMeshPLG split when the
 * triangle list left them all zero. Each triangle is keyed by its (order-
 * independent) vertex triple and assigned the material of the split it belongs to.
 */
function applyBinMeshMaterials(stream: BinaryStream, header: ChunkHeader, triangles: RWTriangle[]): void {
  const extension = findChild(stream, header.dataStart, header.end, RwSection.EXTENSION);
  if (!extension) {
    return;
  }
  const bin = findChild(stream, extension.dataStart, extension.end, RwSection.BIN_MESH_PLG);
  if (!bin) {
    return;
  }

  stream.seek(bin.dataStart);
  const tristrip = (stream.u32() & 1) !== 0;
  const numMeshes = stream.u32();
  stream.u32(); // total index count (unused)

  const materialByTriple = new Map<string, number>();
  for (let mesh = 0; mesh < numMeshes; mesh += 1) {
    const numIndices = stream.u32();
    const materialIndex = stream.u32();
    const indices: number[] = [];
    for (let i = 0; i < numIndices; i += 1) {
      indices.push(stream.u32());
    }
    forEachSplitTriangle(indices, tristrip, (a, b, c) => materialByTriple.set(tripleKey(a, b, c), materialIndex));
  }

  for (const tri of triangles) {
    const material = materialByTriple.get(tripleKey(tri.a, tri.b, tri.c));
    if (material !== undefined) {
      tri.materialIndex = material;
    }
  }
}

/** Visit each triangle of one BinMesh split (trilist triples, or an unwound tristrip). */
function forEachSplitTriangle(
  indices: number[],
  tristrip: boolean,
  visit: (a: number, b: number, c: number) => void,
): void {
  if (!tristrip) {
    for (let i = 0; i + 2 < indices.length; i += 3) {
      visit(indices[i], indices[i + 1], indices[i + 2]);
    }

    return;
  }
  for (let i = 0; i + 2 < indices.length; i += 1) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    if (a !== b && b !== c && a !== c) {
      visit(a, b, c); // winding is irrelevant — we only key the triple
    }
  }
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

  // Some exporters leave every face's material index 0 and store the real
  // per-material split in BinMeshPLG; recover the assignment from it.
  if (materials.length > 1 && triangles.every((t) => t.materialIndex === 0)) {
    applyBinMeshMaterials(stream, header, triangles);
  }

  const lights = parseLightEffects(stream, header);
  const nightColors = parseNightColors(stream, header, numVertices);

  return {
    flags,
    lights,
    materials,
    nightColors,
    normals,
    numUVLayers,
    positions,
    prelitColors,
    skin,
    triangles,
    uvLayers,
  };
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

/**
 * Parse the geometry's 2d Effect plugin (`0x253F2F8`) — the per-model light/corona definitions for
 * street lamps, signs, traffic lights, etc. Each entry is `position(3×f32), type(u32), size(u32), data`;
 * we read the **Light** entries (type 0) and skip the rest by `size`. The light data starts with the RGBA
 * colour + four floats (corona far-clip, point-light range, corona size, shadow size), five flag/mode bytes,
 * then the 24-char corona texture name. Returns [] when the model has no effects.
 */
function parseLightEffects(stream: BinaryStream, header: ChunkHeader): RWLight2d[] {
  const extension = findChild(stream, header.dataStart, header.end, RwSection.EXTENSION);
  if (!extension) {
    return [];
  }
  const fx = findChild(stream, extension.dataStart, extension.end, RwSection.TWO_D_EFFECT);
  if (!fx) {
    return [];
  }

  stream.seek(fx.dataStart);
  const count = stream.u32();
  const lights: RWLight2d[] = [];
  for (let i = 0; i < count; i += 1) {
    const position: [number, number, number] = [stream.f32(), stream.f32(), stream.f32()];
    const entryType = stream.u32();
    const dataSize = stream.u32();
    const entryEnd = stream.position + dataSize;
    if (entryType === LIGHT_EFFECT) {
      const color: [number, number, number, number] = [stream.u8(), stream.u8(), stream.u8(), stream.u8()];
      const coronaFarClip = stream.f32();
      stream.f32(); // point-light range (unused for now)
      const coronaSize = stream.f32();
      stream.f32(); // shadow size
      stream.skip(4); // corona show-mode, reflection, flare type, shadow-colour multiplier
      const flags = stream.u8(); // flags1 (corona checks / fog type)
      const coronaTexture = stream.string(24);
      lights.push({ color, coronaFarClip, coronaSize, coronaTexture, flags, position });
    }
    stream.seek(entryEnd); // skip to the next entry regardless of type/size
  }

  return lights;
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

  const extension = findChild(stream, header.dataStart, header.end, RwSection.EXTENSION);
  const effects = extension ? parseMaterialEffects(stream, extension) : undefined;

  return { color, effects, texture, textured };
}

/** Parse the SA reflection/specular material-effect plugins from a material's Extension chunk
 *  (MatFX env-map `0x120`, reflection `0x253f2fc`, specular `0x253f2f6`). Undefined if none present. */
function parseMaterialEffects(stream: BinaryStream, ext: ChunkHeader): RWMaterialEffects | undefined {
  const effects: RWMaterialEffects = {};

  const matfx = findChild(stream, ext.dataStart, ext.end, RwSection.MATFX);
  if (matfx) {
    const envMap = parseMatFxEnvMap(stream, matfx);
    if (envMap) {
      effects.envMap = envMap;
    }
  }

  const refl = findChild(stream, ext.dataStart, ext.end, RwSection.REFLECTION_MAT);
  if (refl) {
    stream.seek(refl.dataStart);
    const scaleX = stream.f32();
    const scaleY = stream.f32();
    const offsetX = stream.f32();
    const offsetY = stream.f32();
    const intensity = stream.f32();
    effects.reflection = { intensity, offset: [offsetX, offsetY], scale: [scaleX, scaleY] };
  }

  const spec = findChild(stream, ext.dataStart, ext.end, RwSection.SPECULAR_MAT);
  if (spec) {
    stream.seek(spec.dataStart);
    const level = stream.f32();
    const texture = stream.string(spec.end - spec.dataStart - 4); // remaining = char[24] texture name
    effects.specular = { level, texture };
  }

  return (effects.envMap ?? effects.reflection ?? effects.specular) ? effects : undefined;
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

/** Parse the env-map effect from a material's RpMatFX (`0x120`) plugin; undefined if it isn't an env map.
 *  Layout: effectType, slotType, coefficient(f32), useFrameBufferAlpha(u32), hasTexture(u32), [Texture chunk]. */
function parseMatFxEnvMap(stream: BinaryStream, header: ChunkHeader): RWMaterialEffects['envMap'] {
  stream.seek(header.dataStart);
  const effectType = stream.u32();
  const slotType = stream.u32();
  if (effectType !== MatFxEffect.ENVMAP || slotType !== MatFxEffect.ENVMAP) {
    return undefined; // only env-map effects mark a reflective material (bump/uv-transform ignored)
  }
  const coefficient = stream.f32();
  const useFrameBufferAlpha = stream.u32() !== 0;
  const hasTexture = stream.u32() !== 0;

  let texture: null | string = null;
  if (hasTexture) {
    const texChunk = findChild(stream, header.dataStart + 20, header.end, RwSection.TEXTURE);
    if (texChunk) {
      texture = parseTexture(stream, texChunk).name || null;
    }
  }

  return { coefficient, texture, useFrameBufferAlpha };
}

/**
 * Parse the geometry's "extra vertex colour" plugin (`0x253F2F9`) — SA's **night** prelit colour set. The
 * chunk is a `u32` flag (1 = present) followed by `numVertices × RGBA`. Bright (warm) texels here are baked
 * lit windows: the engine swaps to these at night so windows glow while the day prelit stays dark. Null when
 * absent or the size doesn't match.
 */
function parseNightColors(stream: BinaryStream, header: ChunkHeader, numVertices: number): null | Uint8Array {
  const extension = findChild(stream, header.dataStart, header.end, RwSection.EXTENSION);
  if (!extension) {
    return null;
  }
  const chunk = findChild(stream, extension.dataStart, extension.end, RwSection.NIGHT_VERTEX_COLORS);
  if (!chunk || chunk.size !== numVertices * 4 + 4) {
    return null;
  }
  stream.seek(chunk.dataStart);
  if (stream.u32() === 0) {
    return null; // leading flag says "no night colours"
  }

  return stream.bytes(numVertices * 4);
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

/** Order-independent key for a triangle's vertex triple. */
function tripleKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join(',');
}
