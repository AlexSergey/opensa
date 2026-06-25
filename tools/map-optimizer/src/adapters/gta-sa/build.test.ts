import { buildVer2Buffer, openArchive } from '@opensa/renderware/archive/img-archive';
import { describe, expect, it } from 'vitest';

import { rebuildArchive } from './build';

describe('rebuildArchive', () => {
  describe('positive cases', () => {
    it('swaps optimized entries and preserves the rest', () => {
      const source = openArchive(
        buildVer2Buffer([
          { data: new Uint8Array([1, 1, 1, 1]), name: 'keep.dff' },
          { data: new Uint8Array([2, 2, 2, 2]), name: 'swap.dff' },
        ]),
      );
      const optimized = new Map([['swap.dff', new Uint8Array([9, 9, 9, 9, 9])]]);

      const rebuilt = openArchive(rebuildArchive(source, optimized));

      expect(rebuilt.names.sort()).toEqual(['keep.dff', 'swap.dff']);
      // untouched entry identical on its meaningful prefix (archive reads are sector-padded).
      expect([...new Uint8Array(rebuilt.get('keep.dff')!).subarray(0, 4)]).toEqual([1, 1, 1, 1]);
      // swapped entry carries the optimized bytes.
      expect([...new Uint8Array(rebuilt.get('swap.dff')!).subarray(0, 5)]).toEqual([9, 9, 9, 9, 9]);
    });

    it('is a faithful copy when nothing is optimized', () => {
      const source = openArchive(buildVer2Buffer([{ data: new Uint8Array([7, 7, 7, 7]), name: 'a.dff' }]));
      const rebuilt = openArchive(rebuildArchive(source, new Map()));
      expect(rebuilt.names).toEqual(['a.dff']);
      expect([...new Uint8Array(rebuilt.get('a.dff')!).subarray(0, 4)]).toEqual([7, 7, 7, 7]);
    });
  });
});
