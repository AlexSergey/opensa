import { describe, expect, it } from 'vitest';

import { cellCentre, cellModelName, ideObjsLine, iplInstLine } from './finalize';

describe('finalize line emitters', () => {
  describe('positive cases', () => {
    it('names a cell-LOD with the lod prefix (negative coords kept)', () => {
      expect(cellModelName(3, -7)).toBe('lod_3_-7');
    });

    it('places the cell centre at (cx+0.5, cy+0.5)·cellSize, world Z 0', () => {
      expect(cellCentre({ cx: 3, cy: -7 }, 256)).toEqual([896, -1664, 0]);
    });

    it('emits an IDE objs line (id, model, txd, drawDist, flags)', () => {
      expect(ideObjsLine(5000, 'lod_0_0', 1500)).toBe('5000, lod_0_0, lod_0_0, 1500, 0');
    });

    it('emits an IPL inst line with identity rotation and no LOD link', () => {
      expect(iplInstLine(5000, 'lod_0_0', [128, 128, 0])).toBe('5000, lod_0_0, 0, 128, 128, 0, 0, 0, 0, 1, -1');
    });
  });
});
