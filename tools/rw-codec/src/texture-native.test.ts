import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { describe, expect, it } from 'vitest';

import { RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, type RwChunk, writeRw } from './chunk';
import { buildMipChain } from './mip';
import { encodeDxtStruct, encodeRgba8888Struct, readTextureName } from './texture-native';

const RW_VERSION = 0x1803ffff; // a real SA RenderWare stream version

/** An 88-byte TextureNative header with the given name (the fields `encodeRgba8888Struct` preserves). */
function originalHeader(name: string): Uint8Array {
  const out = new Uint8Array(88);
  new TextEncoder().encodeInto(name, out.subarray(8, 40));

  return out;
}

/** A flat `size × size` RGBA buffer of one colour. */
function solid(size: number, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }

  return out;
}

/** Wrap a raster Struct in TextureDictionary → TextureNative → Struct so `parseTxd` can read it. */
function wrapTxd(rasterStruct: Uint8Array): Uint8Array {
  const dictStruct = new Uint8Array(4);
  new DataView(dictStruct.buffer).setUint16(0, 1, true); // numTextures = 1
  const chunk = (type: number, children: RwChunk[], data?: Uint8Array): RwChunk => ({
    children,
    data,
    type,
    version: RW_VERSION,
  });

  return writeRw({
    chunks: [
      {
        children: [
          { data: dictStruct, type: RW_STRUCT, version: RW_VERSION },
          chunk(RW_TEXTURE_NATIVE, [{ data: rasterStruct, type: RW_STRUCT, version: RW_VERSION }]),
        ],
        type: RW_TEXTURE_DICTIONARY,
        version: RW_VERSION,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

describe('encodeRgba8888Struct', () => {
  describe('positive cases', () => {
    it('round-trips through parseTxd as an 8888 texture with all mip levels', () => {
      // a 2×2 base level (R, G, B, white) + a 1×1 mip — RGBA input.
      const levels = [
        {
          data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
          height: 2,
          width: 2,
        },
        { data: new Uint8Array([64, 96, 64, 255]), height: 1, width: 1 },
      ];
      const struct = encodeRgba8888Struct(originalHeader('wall'), levels, true);

      expect(readTextureName(struct)).toBe('wall');

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures).toHaveLength(1);
      const texture = textures[0];
      expect(texture.name).toBe('wall');
      expect(texture.format).toBe('rgba8888');
      expect(texture.hasAlpha).toBe(true);
      expect(texture.mipmaps.map((m) => [m.width, m.height])).toEqual([
        [2, 2],
        [1, 1],
      ]);
      // base level pixels survive the BGRA store → RGBA read.
      expect([...texture.mipmaps[0].data]).toEqual([...levels[0].data]);
    });
  });
});

describe('encodeDxtStruct', () => {
  describe('positive cases', () => {
    it('round-trips an opaque image through parseTxd as DXT1 with its mip chain', () => {
      const struct = encodeDxtStruct('body', 'dxt1', buildMipChain(solid(4, [200, 50, 25, 255]), 4, 4));

      expect(readTextureName(struct)).toBe('body');

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures).toHaveLength(1);
      expect(textures[0].name).toBe('body');
      expect(textures[0].format).toBe('dxt1');
      expect(textures[0].mipmaps.map((m) => [m.width, m.height])).toEqual([
        [4, 4],
        [2, 2],
        [1, 1],
      ]);
    });

    it('encodes an image with alpha as DXT5', () => {
      const struct = encodeDxtStruct('glass', 'dxt5', buildMipChain(solid(4, [200, 50, 25, 128]), 4, 4));

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures[0].format).toBe('dxt5');
      expect(textures[0].hasAlpha).toBe(true);
    });
  });
});
