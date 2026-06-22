import { describe, expect, it } from 'vitest';

import type { Manifest } from '../loaders';

import { manifestTotals, verifyTotals } from './verify';

const manifest: Manifest = {
  chunks: {
    data: [{ bytes: 1, cached: false, entries: 3, file: 'd.zip', hash: 'd' }],
    models: [{ bytes: 1, cached: true, entries: 5, file: 'm.zip', hash: 'm' }],
    others: [],
    textures: [
      { bytes: 1, cached: true, entries: 7, file: 't0.zip', hash: 't0' },
      { bytes: 1, cached: true, entries: 2, file: 't1.zip', hash: 't1' },
    ],
  },
  game: 'test',
  version: 'test-1',
};

describe('manifestTotals', () => {
  describe('positive cases', () => {
    it('sums chunk count and entry count across all groups', () => {
      expect(manifestTotals(manifest)).toEqual({ chunks: 4, entries: 17 });
    });
  });
});

describe('verifyTotals', () => {
  describe('negative cases', () => {
    it('reports a missing chunk', () => {
      expect(verifyTotals({ chunks: 4, entries: 17 }, { chunks: 3, entries: 17 })).toEqual([
        'expected 4 chunks, got 3',
      ]);
    });

    it('reports an entry-count mismatch', () => {
      expect(verifyTotals({ chunks: 4, entries: 17 }, { chunks: 4, entries: 16 })).toEqual([
        'expected 17 entries, got 16',
      ]);
    });
  });

  describe('positive cases', () => {
    it('returns no problems when totals match', () => {
      expect(verifyTotals({ chunks: 4, entries: 17 }, { chunks: 4, entries: 17 })).toEqual([]);
    });
  });
});
