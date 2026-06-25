import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { downsample } from '@opensa/rw-codec/mip';
import { encodeRgba8888Struct } from '@opensa/rw-codec/texture-native';

import type { TextureSource } from './texture-source';

/**
 * Build one per-cell TXD (plan 002, Phase 2) holding the cell's textures, **downscaled** to a far-LOD budget and
 * stored uncompressed A8R8G8B8. The cell DFF keeps its original material/texture **names** + UVs untouched
 * (perfect tiling — no atlas), so it resolves every texture from this single dictionary. Reuses the engine
 * `parseTxd` (via the source) + map-optimizer's `encodeRgba8888Struct` + chunk codec; a true single-texture
 * atlas (fewer draws) is a later optimisation. Names missing from the source are skipped.
 */
export function encodeCellTxd(textures: readonly string[], source: TextureSource, maxSize: number): Uint8Array {
  const natives: RwChunk[] = [];
  for (const name of textures) {
    const texture = source.get(name);
    if (texture) {
      natives.push(textureNative(name, texture, maxSize));
    }
  }

  const struct = new Uint8Array(4);
  new DataView(struct.buffer).setUint16(0, natives.length, true); // numTextures (deviceId follows, 0)

  return writeRw({
    chunks: [container(RW_TEXTURE_DICTIONARY, [leaf(RW_STRUCT, struct), ...natives, container(RW_EXTENSION, [])])],
    trailing: new Uint8Array(0),
  });
}

const RW_VERSION = 0x1803ffff;
const NATIVE_PLATFORM = 8; // PC D3D8
const NATIVE_FILTER = 0x1102; // linear + wrap addressing
const NATIVE_HEADER = 88;

function container(type: number, children: RwChunk[]): RwChunk {
  return { children, type, version: RW_VERSION };
}

/** Downscale RGBA (2× box) until both dimensions are ≤ `maxSize`. */
function downscale(
  rgba: Uint8Array,
  width: number,
  height: number,
  maxSize: number,
): { data: Uint8Array; height: number; width: number } {
  let level = { data: rgba, height, width };
  while (level.width > maxSize || level.height > maxSize) {
    level = downsample(level.data, level.width, level.height);
  }

  return level;
}

function leaf(type: number, data: Uint8Array): RwChunk {
  return { data, type, version: RW_VERSION };
}

/** An 88-byte TextureNative header template (platform / filter / name / mask / rasterType / flags) for the
 *  uncompressed encoder to fill in the format + level fields. */
function template(name: string): Uint8Array {
  const header = new Uint8Array(NATIVE_HEADER);
  const view = new DataView(header.buffer);
  view.setUint32(0, NATIVE_PLATFORM, true);
  view.setUint32(4, NATIVE_FILTER, true);
  header.set(new TextEncoder().encode(name.slice(0, 31)), 8); // name[32], NUL-terminated
  header[86] = 4; // rasterType (standard texture)

  return header;
}

function textureNative(
  name: string,
  texture: { hasAlpha: boolean; height: number; rgba: Uint8Array; width: number },
  maxSize: number,
): RwChunk {
  const level = downscale(texture.rgba, texture.width, texture.height, maxSize);
  const struct = encodeRgba8888Struct(template(name), [level], texture.hasAlpha);

  return container(RW_TEXTURE_NATIVE, [leaf(RW_STRUCT, struct), container(RW_EXTENSION, [])]);
}
