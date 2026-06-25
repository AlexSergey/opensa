import { describe, expect, it } from 'vitest';

import { decodeDxt } from './dxt';
import { encodeDxt } from './dxt-encode';

/** A 4×4 RGBA block from a per-pixel colour function. */
function block(fn: (i: number) => [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i += 1) {
    out.set(fn(i), i * 4);
  }

  return out;
}

describe('encodeDxt', () => {
  describe('positive cases', () => {
    it('round-trips a solid colour exactly (DXT1)', () => {
      const red = block(() => [255, 0, 0, 255]);
      const decoded = decodeDxt('dxt1', encodeDxt('dxt1', red, 4, 4), 4, 4);
      expect([...decoded.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
      expect([...decoded.subarray(60, 64)]).toEqual([255, 0, 0, 255]);
    });

    it('approximates a two-colour block within tolerance (DXT1)', () => {
      // left half red, right half blue.
      const src = block((i) => (i % 4 < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
      const decoded = decodeDxt('dxt1', encodeDxt('dxt1', src, 4, 4), 4, 4);
      for (let i = 0; i < 16; i += 1) {
        const want = i % 4 < 2 ? [255, 0, 0] : [0, 0, 255];
        for (let c = 0; c < 3; c += 1) {
          expect(Math.abs(decoded[i * 4 + c] - want[c])).toBeLessThanOrEqual(8);
        }
      }
    });

    it('preserves punch-through alpha (DXT1)', () => {
      const src = block((i) => (i === 0 ? [255, 0, 0, 0] : [255, 0, 0, 255]));
      const decoded = decodeDxt('dxt1', encodeDxt('dxt1', src, 4, 4), 4, 4);
      expect(decoded[3]).toBe(0); // pixel 0 transparent
      expect(decoded[7]).toBe(255); // pixel 1 opaque
    });

    it('round-trips graded alpha within the 3-bit (8-level) quantization bound (DXT5)', () => {
      const src = block((i) => [10, 20, 30, i * 17]);
      const decoded = decodeDxt('dxt5', encodeDxt('dxt5', src, 4, 4), 4, 4);
      for (let i = 0; i < 16; i += 1) {
        // 8 alpha levels over 0–255 ⇒ ~36 apart ⇒ up to ~18 quantization error.
        expect(Math.abs(decoded[i * 4 + 3] - i * 17)).toBeLessThanOrEqual(20);
      }
    });
  });
});
