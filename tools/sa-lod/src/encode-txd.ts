import type { RwChunk } from '@opensa/rw-codec/chunk';

import { RW_EXTENSION, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { buildMipChain, downsample } from '@opensa/rw-codec/mip';
import { encodeDxtStruct } from '@opensa/rw-codec/texture-native';

import type { TextureSource } from './texture-source';

/**
 * Build one shared LOD TXD holding the given textures, **downscaled** to a far-LOD budget and **DXT-compressed**
 * (DXT5 for alpha-cutout textures, DXT1 for opaque) with a full mip chain — uncompressed A8R8G8B8 blows the IMG up
 * ~4× (e.g. a full cell build's TXDs were ~324 MB raw vs ~81 MB DXT). The DFF keeps its original material/texture
 * **names** + UVs untouched (perfect tiling — no atlas), so it resolves every texture from this single dictionary.
 * Reuses the engine `parseTxd` (via the source) + `encodeDxtStruct` + chunk codec. Names missing from the source
 * are skipped.
 */
export function encodeLodTxd(textures: readonly string[], source: TextureSource, maxSize: number): Uint8Array {
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

function textureNative(
  name: string,
  texture: { hasAlpha: boolean; height: number; rgba: Uint8Array; width: number },
  maxSize: number,
): RwChunk {
  const level = downscale(texture.rgba, texture.width, texture.height, maxSize);
  const mips = buildMipChain(level.data, level.width, level.height);
  const struct = encodeDxtStruct(name, texture.hasAlpha ? 'dxt5' : 'dxt1', mips);

  return container(RW_TEXTURE_NATIVE, [leaf(RW_STRUCT, struct), container(RW_EXTENSION, [])]);
}
