import { describe, expect, it } from 'vitest';

import { decodeDxt } from './dxt';

// RGB565 for pure red (0xF800) and pure blue (0x001F).
const RED565 = 0xf800;
const BLUE565 = 0x001f;

function dxt1Block(c0: number, c1: number, indices: number): Uint8Array {
  return new Uint8Array([
    c0 & 0xff,
    (c0 >> 8) & 0xff,
    c1 & 0xff,
    (c1 >> 8) & 0xff,
    indices & 0xff,
    (indices >> 8) & 0xff,
    (indices >> 16) & 0xff,
    (indices >> 24) & 0xff,
  ]);
}

function pixel(rgba: Uint8Array, width: number, x: number, y: number): [number, number, number, number] {
  const o = (y * width + x) * 4;

  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]];
}

describe('decodeDxt', () => {
  describe('positive cases', () => {
    it('decodes a solid DXT1 block (all index 0 → colour0)', () => {
      const rgba = decodeDxt('dxt1', dxt1Block(RED565, BLUE565, 0), 4, 4);
      expect(rgba.length).toBe(4 * 4 * 4);
      expect(pixel(rgba, 4, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(pixel(rgba, 4, 3, 3)).toEqual([255, 0, 0, 255]);
    });

    it('selects colour1 for index-1 pixels', () => {
      // pixel 0 → index 1 (0b01); the rest index 0.
      const rgba = decodeDxt('dxt1', dxt1Block(RED565, BLUE565, 0b01), 4, 4);
      expect(pixel(rgba, 4, 0, 0)).toEqual([0, 0, 255, 255]);
      expect(pixel(rgba, 4, 1, 0)).toEqual([255, 0, 0, 255]);
    });

    it('makes index 3 transparent when c0 <= c1 (1-bit alpha DXT1)', () => {
      // c0 (red) <= c1 (blue) numerically? 0xF800 > 0x001F, so swap to force the punch-through case.
      const rgba = decodeDxt('dxt1', dxt1Block(BLUE565, RED565, 0b11), 4, 4);
      expect(pixel(rgba, 4, 0, 0)).toEqual([0, 0, 0, 0]); // index 3 → transparent
    });

    it('decodes DXT3 explicit alpha (full + zero nibble)', () => {
      // alpha bytes: pixel0 nibble 0xF (→255), pixel1 nibble 0x0 (→0); colour part = solid red.
      const block = new Uint8Array(16);
      block[0] = 0x0f; // pixel0 alpha=F, pixel1 alpha=0
      const color = dxt1Block(RED565, BLUE565, 0);
      block.set(color, 8);
      const rgba = decodeDxt('dxt3', block, 4, 4);
      expect(pixel(rgba, 4, 0, 0)[3]).toBe(255);
      expect(pixel(rgba, 4, 1, 0)[3]).toBe(0);
    });
  });
});
