import { describe, expect, it } from 'vitest';

import { decodePng } from './png-decode';
import { encodePng } from './test-utils';

/** A 4×3 RGBA gradient — varied enough that every scanline filter predicts non-trivially. */
function gradient(): Uint8Array {
  const out = new Uint8Array(4 * 3 * 4);
  for (let y = 0; y < 3; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const i = (y * 4 + x) * 4;
      out[i] = x * 60;
      out[i + 1] = y * 80;
      out[i + 2] = (x + y) * 30;
      out[i + 3] = 255 - x * 20;
    }
  }

  return out;
}

describe('decodePng', () => {
  describe('negative cases', () => {
    it('throws on a non-PNG signature', () => {
      expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a PNG/);
    });

    it('throws on an unsupported colour type (e.g. palette)', () => {
      const png = encodePng(gradient(), 4, 3);
      png[25] = 3; // IHDR colourType byte → palette (CRC is not checked by the decoder)
      expect(() => decodePng(png)).toThrow(/unsupported PNG/);
    });
  });

  describe('positive cases', () => {
    it('round-trips an 8-bit RGBA image (colour type 6)', () => {
      const rgba = gradient();
      const decoded = decodePng(encodePng(rgba, 4, 3));
      expect(decoded.width).toBe(4);
      expect(decoded.height).toBe(3);
      expect([...decoded.rgba]).toEqual([...rgba]);
    });

    it('round-trips an 8-bit RGB image (colour type 2), filling alpha = 255', () => {
      const rgb = gradient();
      for (let i = 3; i < rgb.length; i += 4) {
        rgb[i] = 255; // opaque source so the type-2 (no alpha) round-trip matches
      }
      const decoded = decodePng(encodePng(rgb, 4, 3, { colorType: 2 }));
      expect([...decoded.rgba]).toEqual([...rgb]);
    });

    it('reverses every scanline filter (None/Sub/Up/Average/Paeth)', () => {
      const rgba = gradient();
      for (const filter of [0, 1, 2, 3, 4]) {
        const decoded = decodePng(encodePng(rgba, 4, 3, { filter }));
        expect([...decoded.rgba], `filter ${filter}`).toEqual([...rgba]);
      }
    });
  });
});
