import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { buildMipChain, downsample } from '@opensa/rw-codec/mip';
import { encodeDxtStruct } from '@opensa/rw-codec/texture-native';

import type { TextureSource } from './texture-source';

/**
 * Like {@link encodeLodTxd}, but halves each texture `halvings` power-of-two steps (1 → ½ each side, ¼ area)
 * instead of capping to a size budget — the sa-lod-generator "50 % textures" clone. Same DXT + full mips; the DFF's
 * material/texture **names** + UVs are untouched, so a verbatim HD-clone DFF resolves every texture from here.
 */
export function encodeHalvedTxd(textures: readonly string[], source: TextureSource, halvings: number): Uint8Array {
  return buildTxd(textures, source, (rgba, width, height) => halve(rgba, width, height, halvings));
}

/**
 * Build one shared LOD TXD holding the given textures, **downscaled** to a far-LOD budget and **DXT-compressed**
 * (DXT5 for alpha-cutout textures, DXT1 for opaque) with a full mip chain — uncompressed A8R8G8B8 blows the IMG up
 * ~4× (e.g. a full cell build's TXDs were ~324 MB raw vs ~81 MB DXT). The DFF keeps its original material/texture
 * **names** + UVs untouched (perfect tiling — no atlas), so it resolves every texture from this single dictionary.
 * Reuses the engine `parseTxd` (via the source) + `encodeDxtStruct` + chunk codec. Names missing from the source
 * are skipped.
 */
export function encodeLodTxd(textures: readonly string[], source: TextureSource, maxSize: number): Uint8Array {
  return buildTxd(textures, source, (rgba, width, height) => downscale(rgba, width, height, maxSize));
}

/** Assemble a TEXTURE_DICTIONARY from the source textures, each reduced to its top level by `reduce`, DXT + mips. */
function buildTxd(
  textures: readonly string[],
  source: TextureSource,
  reduce: (rgba: Uint8Array, width: number, height: number) => Level,
): Uint8Array {
  const natives: RwChunk[] = [];
  for (const name of textures) {
    const texture = source.get(name);
    if (texture) {
      const level = reduce(texture.rgba, texture.width, texture.height);
      natives.push(textureNative(name, texture.hasAlpha, level));
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

interface Level {
  data: Uint8Array;
  height: number;
  width: number;
}

function container(type: number, children: RwChunk[]): RwChunk {
  return { children, type, version: RW_VERSION };
}

/** Downscale RGBA (2× box) until both dimensions are ≤ `maxSize`. */
function downscale(rgba: Uint8Array, width: number, height: number, maxSize: number): Level {
  let level: Level = { data: rgba, height, width };
  while (level.width > maxSize || level.height > maxSize) {
    level = downsample(level.data, level.width, level.height);
  }

  return level;
}

/** Halve RGBA (2× box) `halvings` times, but never below 1 px in either dimension. */
function halve(rgba: Uint8Array, width: number, height: number, halvings: number): Level {
  let level: Level = { data: rgba, height, width };
  for (let i = 0; i < halvings && level.width > 1 && level.height > 1; i += 1) {
    level = downsample(level.data, level.width, level.height);
  }

  return level;
}

function leaf(type: number, data: Uint8Array): RwChunk {
  return { data, type, version: RW_VERSION };
}

function textureNative(name: string, hasAlpha: boolean, level: Level): RwChunk {
  const mips = buildMipChain(level.data, level.width, level.height);
  const struct = encodeDxtStruct(name, hasAlpha ? 'dxt5' : 'dxt1', mips);

  return container(RW_TEXTURE_NATIVE, [leaf(RW_STRUCT, struct), container(RW_EXTENSION, [])]);
}
