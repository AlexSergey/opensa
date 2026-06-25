import { describe, expect, it } from 'vitest';

import { rotatingStatus, toPercent } from './boot-status';

describe('toPercent', () => {
  describe('negative cases', () => {
    it('is 0 when nothing is known yet', () => {
      expect(toPercent({ loadedBytes: 0, loadedChunks: 0, totalBytes: 0, totalChunks: 0 })).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('rounds the byte ratio and clamps to 100', () => {
      expect(toPercent({ loadedBytes: 50, loadedChunks: 1, totalBytes: 200, totalChunks: 4 })).toBe(25);
      expect(toPercent({ loadedBytes: 999, loadedChunks: 4, totalBytes: 200, totalChunks: 4 })).toBe(100);
    });
  });
});

describe('rotatingStatus', () => {
  describe('negative cases', () => {
    it('returns an empty string for no messages', () => {
      expect(rotatingStatus([], 3)).toBe('');
    });
  });

  describe('positive cases', () => {
    it('wraps the index around the list (including negatives)', () => {
      const messages = ['a', 'b', 'c'];
      expect(rotatingStatus(messages, 0)).toBe('a');
      expect(rotatingStatus(messages, 4)).toBe('b');
      expect(rotatingStatus(messages, -1)).toBe('c');
    });
  });
});
