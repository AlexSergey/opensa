import { describe, expect, it } from 'vitest';

import type { IplTransform } from './ipl-text-retransform';

import { retransformTextIpl } from './ipl-text-retransform';

const IPL = [
  'inst',
  '# a comment',
  '100, hd_a, 0, 10, 20, 30, 0, 0, 0, 1, 1',
  '200, lod_a, 0, 10, 20, 30, 0, 0, 0.208, 0.978, -1',
  '300, other, 0, 5, 5, 5, 0, 0, 0, 1, -1',
  'end',
].join('\n');

const hdTransform: IplTransform = { pos: [10, 20, 30], rot: [0, 0, -0.383, 0.924] };

describe('retransformTextIpl', () => {
  describe('negative cases', () => {
    it('is unchanged with no transforms', () => {
      expect(retransformTextIpl(IPL, new Map())).toEqual({ changed: false, text: IPL });
    });

    it('leaves non-targeted rows byte-identical', () => {
      const result = retransformTextIpl(IPL, new Map([[1, hdTransform]]));
      expect(result.text).toContain('100, hd_a, 0, 10, 20, 30, 0, 0, 0, 1, 1');
      expect(result.text).toContain('300, other, 0, 5, 5, 5, 0, 0, 0, 1, -1');
      expect(result.text).toContain('# a comment');
    });
  });

  describe('positive cases', () => {
    it('rewrites only the targeted row transform, preserving id/model/interior/lod', () => {
      const result = retransformTextIpl(IPL, new Map([[1, hdTransform]]));
      expect(result.changed).toBe(true);
      expect(result.text).toContain('200, lod_a, 0, 10, 20, 30, 0, 0, -0.383, 0.924, -1');
    });

    it('indexes rows past comments (row 1 is the second data row, not the comment)', () => {
      const result = retransformTextIpl(IPL, new Map([[0, { pos: [1, 2, 3], rot: [0, 0, 0, 1] }]]));
      expect(result.text).toContain('100, hd_a, 0, 1, 2, 3, 0, 0, 0, 1, 1');
    });
  });
});
