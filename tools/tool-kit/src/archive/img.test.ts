import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { describe, expect, it } from 'vitest';

import { openImg } from './img';

/** Two-entry VER2 archive bytes to open + edit. */
function sampleImg(): Uint8Array {
  return buildVer2Buffer([
    { data: Uint8Array.of(1, 2, 3, 4), name: 'alpha.dff' },
    { data: Uint8Array.of(5, 6, 7, 8), name: 'beta.dff' },
  ]);
}

describe('EditableImg', () => {
  describe('negative cases', () => {
    it('returns null / false for an absent entry', () => {
      const img = openImg(sampleImg());
      expect(img.get('missing.dff')).toBeNull();
      expect(img.has('missing.dff')).toBe(false);
      expect(img.delete('missing.dff')).toBe(false);
    });

    it('reports a deleted entry as gone', () => {
      const img = openImg(sampleImg());
      expect(img.delete('alpha.dff')).toBe(true);
      expect(img.has('alpha.dff')).toBe(false);
      expect(img.names()).toEqual(['beta.dff']);
    });
  });

  describe('positive cases', () => {
    // IMG entries are sector-padded (2048) by the VER2 writer, so reads carry trailing zeros — assert prefixes.
    it('reads original entries (case-insensitive)', () => {
      const img = openImg(sampleImg());
      expect([...(img.get('ALPHA.DFF') ?? []).slice(0, 4)]).toEqual([1, 2, 3, 4]);
      expect(img.names()).toEqual(['alpha.dff', 'beta.dff']);
    });

    it('round-trips add / replace / delete through a rebuild', () => {
      const img = openImg(sampleImg());
      img.set('alpha.dff', Uint8Array.of(9, 9)); // replace
      img.set('gamma.dff', Uint8Array.of(7)); // add
      img.delete('beta.dff'); // remove

      const rebuilt = openImg(img.build());
      expect(rebuilt.names()).toEqual(['alpha.dff', 'gamma.dff']);
      expect([...(rebuilt.get('alpha.dff') ?? []).slice(0, 2)]).toEqual([9, 9]);
      expect([...(rebuilt.get('gamma.dff') ?? []).slice(0, 1)]).toEqual([7]);
      expect(rebuilt.has('beta.dff')).toBe(false);
    });
  });
});
