import { parseColLibrary } from '@opensa/renderware/parsers/binary/col';
import { describe, expect, it } from 'vitest';

import type { Bounds } from './encode-col';

import { encodeColLibrary } from './encode-col';

const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const bounds = (min: [number, number, number], max: [number, number, number]): Bounds => ({ max, min });

describe('encodeColLibrary', () => {
  describe('negative cases', () => {
    it('emits nothing for no models', () => {
      expect(encodeColLibrary([], [])).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('writes a 120-byte COL3 block (8-byte header + 112-byte body) per model', () => {
      const bytes = encodeColLibrary([bounds([0, 0, 0], [1, 1, 1])], ['lodtest']);
      const view = new DataView(bytes.buffer);

      expect(bytes).toHaveLength(120);
      expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('COL3');
      expect(view.getUint32(4, true)).toBe(112); // body size — must match stock or SA misparses the library
    });

    it('zeroes the counts/offsets/shadow tail (bytes 64..111 of the body), like a stock empty-collision LOD', () => {
      const body = encodeColLibrary([bounds([0, 0, 0], [1, 1, 1])], ['lodtest']).slice(8);

      expect(body.slice(64, 112).every((b) => b === 0)).toBe(true);
    });

    it('names each model from the `names` argument and sets bounds from the bbox', () => {
      const lib = parseColLibrary(ab(encodeColLibrary([bounds([-3, -4, 0], [3, 4, 20])], ['lodalias'])));

      expect(lib[0].name).toBe('lodalias');
      expect(lib[0].bounds.radius).toBeCloseTo(0.5 * Math.hypot(6, 8, 20), 3);
      expect(lib[0].bounds.center).toEqual([0, 0, 10]);
      expect(lib[0].faces).toHaveLength(0);
    });

    it('emits one block per model', () => {
      const lib = parseColLibrary(
        ab(encodeColLibrary([bounds([0, 0, 0], [1, 1, 1]), bounds([0, 0, 0], [2, 2, 2])], ['a', 'b'])),
      );

      expect(lib.map((m) => m.name)).toEqual(['a', 'b']);
    });
  });
});
