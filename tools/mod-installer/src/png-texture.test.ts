import type { RWTexture } from '@opensa/renderware/parsers/binary/types';

import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { describe, expect, it } from 'vitest';

import { pngToTextureNative } from './png-texture';
import { buildTxd, encodePng, solidRgba } from './test-utils';

const VERSION = 0x1803ffff; // RW 3.6 (GTA SA)

/** Round-trip a single PNG through `pngToTextureNative` → dictionary → `parseTxd`. */
function asTexture(name: string, png: Uint8Array): RWTexture {
  const dictionary = parseTxd(Uint8Array.from(buildTxd([pngToTextureNative(name, png, VERSION)], VERSION)).buffer);

  return dictionary.textures[0];
}

describe('pngToTextureNative', () => {
  describe('positive cases', () => {
    it('encodes an opaque PNG as DXT1, parseable with the right name + size + mip chain', () => {
      const texture = asTexture('mytex', encodePng(solidRgba(8, 8, [200, 100, 50, 255]), 8, 8));
      expect(texture.name).toBe('mytex');
      expect(texture.format).toBe('dxt1');
      expect(texture.width).toBe(8);
      expect(texture.height).toBe(8);
      expect(texture.mipmaps).toHaveLength(4); // 8, 4, 2, 1
    });

    it('encodes a PNG with real alpha as DXT5', () => {
      const texture = asTexture('glassy', encodePng(solidRgba(8, 8, [200, 100, 50, 128]), 8, 8));
      expect(texture.format).toBe('dxt5');
      expect(texture.hasAlpha).toBe(true);
    });
  });
});
