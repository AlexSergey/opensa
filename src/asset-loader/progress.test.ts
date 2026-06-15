import { describe, expect, it } from 'vitest';

import { ProgressTracker } from './progress';

const chunks = [
  { bytes: 100, file: 'a.zip' },
  { bytes: 300, file: 'b.zip' },
];

describe('ProgressTracker', () => {
  describe('negative cases', () => {
    it('ignores updates for an unknown chunk', () => {
      const tracker = new ProgressTracker(chunks);
      tracker.set('ghost.zip', 999);
      tracker.complete('ghost.zip');
      expect(tracker.snapshot()).toEqual({ loadedBytes: 0, loadedChunks: 0, totalBytes: 400, totalChunks: 2 });
    });
  });

  describe('positive cases', () => {
    it('starts with nothing loaded but the totals seeded', () => {
      expect(new ProgressTracker(chunks).snapshot()).toEqual({
        loadedBytes: 0,
        loadedChunks: 0,
        totalBytes: 400,
        totalChunks: 2,
      });
    });

    it('accumulates per-chunk bytes and clamps to the chunk total', () => {
      const tracker = new ProgressTracker(chunks);
      tracker.set('a.zip', 60);
      tracker.set('b.zip', 999); // clamped to 300
      const snapshot = tracker.snapshot();
      expect(snapshot.loadedBytes).toBe(360);
      expect(snapshot.loadedChunks).toBe(1); // only b.zip reached its total
    });

    it('counts a completed chunk as fully loaded', () => {
      const tracker = new ProgressTracker(chunks);
      tracker.complete('a.zip');
      expect(tracker.snapshot()).toEqual({ loadedBytes: 100, loadedChunks: 1, totalBytes: 400, totalChunks: 2 });
    });
  });
});
