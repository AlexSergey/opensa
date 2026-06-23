import { describe, expect, it } from 'vitest';

import type { Triangle } from '../core/ir';

import { dedupeFaces } from './dedupe-faces';

const tri = (a: number, b: number, c: number, material = 0): Triangle => ({ a, b, c, material });

describe('dedupeFaces', () => {
  describe('negative cases', () => {
    it('keeps a reversed-winding twin (two-sided alpha)', () => {
      const faces = [tri(0, 1, 2), tri(0, 2, 1)];
      expect(dedupeFaces(faces)).toEqual(faces);
    });

    it('keeps an identical triple with a different material', () => {
      const faces = [tri(0, 1, 2, 0), tri(0, 1, 2, 1)];
      expect(dedupeFaces(faces)).toEqual(faces);
    });
  });

  describe('positive cases', () => {
    it('removes an exact duplicate, keeping the first', () => {
      expect(dedupeFaces([tri(0, 1, 2), tri(0, 1, 2)])).toEqual([tri(0, 1, 2)]);
    });

    it('treats a cyclic rotation as the same face (same winding)', () => {
      expect(dedupeFaces([tri(0, 1, 2), tri(1, 2, 0), tri(2, 0, 1)])).toEqual([tri(0, 1, 2)]);
    });

    it('keeps distinct faces untouched', () => {
      const faces = [tri(0, 1, 2), tri(2, 3, 4), tri(0, 1, 2)];
      expect(dedupeFaces(faces)).toEqual([tri(0, 1, 2), tri(2, 3, 4)]);
    });
  });
});
