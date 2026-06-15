import { describe, expect, it } from 'vitest';

import { staleKeys } from './invalidate';

describe('staleKeys', () => {
  describe('negative cases', () => {
    it('returns nothing when every cached URL is still in the manifest', () => {
      expect(staleKeys(['a', 'b'], ['a', 'b', 'c'])).toEqual([]);
    });

    it('returns nothing for an empty cache', () => {
      expect(staleKeys([], ['a'])).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('returns cached URLs absent from the manifest, preserving order', () => {
      expect(staleKeys(['old1', 'keep', 'old2'], ['keep', 'new'])).toEqual(['old1', 'old2']);
    });
  });
});
