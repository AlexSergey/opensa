import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { decodeDxt } from '@opensa/rw-codec/dxt';
import { describe, expect, it } from 'vitest';

import type { Impostor } from '../../core';

import { encodeAtlasTxd } from './encode-txd';

const RW_VERSION = 0x1803ffff;
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** A baked impostor with a `size`×`size` opaque RGBA image (alpha 255). */
function impostor(name: string, size = 64): Impostor {
  return {
    bbox: { max: [1, 1, 1], min: [0, 0, 0] },
    cards: [],
    image: new Uint8Array(size * size * 4).fill(255),
    name,
    size,
  };
}

describe('encodeAtlasTxd', () => {
  describe('positive cases', () => {
    it('packs each impostor as a named DXT5 texture (not raw RGBA — the size SA can load)', () => {
      const txd = parseTxd(ab(encodeAtlasTxd([impostor('lodtest')], RW_VERSION)));

      expect(txd.textures).toHaveLength(1);
      expect(txd.textures[0].format).toBe('dxt5');
      expect(txd.textures[0].name).toBe('lodtest');
      expect(txd.textures[0]).toMatchObject({ hasAlpha: true, height: 64, width: 64 });
    });

    it('writes a full mip chain', () => {
      const txd = parseTxd(ab(encodeAtlasTxd([impostor('lodtest')], RW_VERSION)));

      expect(txd.textures[0].mipmaps.length).toBeGreaterThan(1);
    });

    it('round-trips: the DXT5 base level decodes back to opaque pixels', () => {
      const txd = parseTxd(ab(encodeAtlasTxd([impostor('lodtest')], RW_VERSION)));
      const rgba = decodeDxt('dxt5', txd.textures[0].mipmaps[0].data, 64, 64);

      let opaque = 0;
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] > 200) {
          opaque += 1;
        }
      }
      expect(opaque).toBeGreaterThan(64 * 64 * 0.9);
    });

    it('packs one texture per impostor', () => {
      const txd = parseTxd(ab(encodeAtlasTxd([impostor('loda'), impostor('lodb')], RW_VERSION)));

      expect(txd.textures.map((t) => t.name)).toEqual(['loda', 'lodb']);
    });
  });
});
