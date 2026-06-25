import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { describe, expect, it } from 'vitest';

import { RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, type RwChunk, writeRw } from './chunk';
import { encodeRgba8888Struct, readTextureName } from './texture-native';

const RW_VERSION = 0x1803ffff; // a real SA RenderWare stream version

/** An 88-byte TextureNative header with the given name (the fields `encodeRgba8888Struct` preserves). */
function originalHeader(name: string): Uint8Array {
  const out = new Uint8Array(88);
  new TextEncoder().encodeInto(name, out.subarray(8, 40));

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
