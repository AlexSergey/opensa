import { describe, expect, it } from 'vitest';

import { chunkByHash, chunkCount, fnv1a, TARGET_CHUNK_BYTES } from './chunk';

const sized = (names: string[], size: number): { name: string; size: number }[] =>
  names.map((name) => ({ name, size }));

describe('fnv1a', () => {
  describe('positive cases', () => {
    it('is deterministic and returns an unsigned 32-bit integer', () => {
      const hash = fnv1a('textures/cj.txd');
      expect(hash).toBe(fnv1a('textures/cj.txd'));
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(hash)).toBe(true);
    });

    it('distinguishes different names', () => {
      expect(fnv1a('a.txd')).not.toBe(fnv1a('b.txd'));
    });
  });
});

describe('chunkCount', () => {
  describe('positive cases', () => {
    it('is at least one even for an empty group', () => {
      expect(chunkCount(0)).toBe(1);
    });

    it('rounds up to cover the total at the target size', () => {
      expect(chunkCount(TARGET_CHUNK_BYTES)).toBe(1);
      expect(chunkCount(TARGET_CHUNK_BYTES + 1)).toBe(2);
      expect(chunkCount(250, 100)).toBe(3);
    });
  });
});

describe('chunkByHash', () => {
  describe('negative cases', () => {
    it('returns no chunks for an empty group', () => {
      expect(chunkByHash([], 100)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('keeps a small group in a single chunk', () => {
      const chunks = chunkByHash(sized(['only.txd'], 10), 100);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].map((e) => e.name)).toEqual(['only.txd']);
    });

    it('places every entry exactly once across the chunks', () => {
      const entries = sized(['alpha', 'beta', 'gamma', 'delta', 'epsilon'], 40); // 200 / 100 → 2
      const names = chunkByHash(entries, 100)
        .flat()
        .map((e) => e.name)
        .sort();
      expect(names).toEqual(['alpha', 'beta', 'delta', 'epsilon', 'gamma']);
    });

    it('is deterministic across calls', () => {
      const entries = sized(['alpha', 'beta', 'gamma', 'delta', 'epsilon'], 40);
      expect(chunkByHash(entries, 100)).toEqual(chunkByHash(entries, 100));
    });

    it('assigns by stable hash bucket (every member of a chunk shares fnv1a % N)', () => {
      const entries = sized(['alpha', 'beta', 'gamma', 'delta', 'epsilon'], 40);
      const n = chunkCount(200, 100); // 2
      for (const chunk of chunkByHash(entries, 100)) {
        const buckets = new Set(chunk.map((e) => fnv1a(e.name) % n));
        expect(buckets.size).toBe(1);
      }
    });
  });
});
