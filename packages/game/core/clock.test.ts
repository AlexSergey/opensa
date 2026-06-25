import { describe, expect, it } from 'vitest';

import { Clock } from './clock';

describe('Clock', () => {
  describe('negative cases', () => {
    it('reports zero delta on the very first tick (no prior frame)', () => {
      const clock = new Clock();
      expect(clock.tick(1234)).toBe(0);
      expect(clock.elapsed).toBe(0);
    });

    it('clamps a large gap (tab switch) to 0.1s', () => {
      const clock = new Clock();
      clock.tick(1000);
      expect(clock.tick(6000)).toBe(0.1); // 5s real gap → clamped
      expect(clock.elapsed).toBeCloseTo(0.1, 6);
    });
  });

  describe('positive cases', () => {
    it('returns the seconds elapsed since the last tick', () => {
      const clock = new Clock();
      clock.tick(1000);
      expect(clock.tick(1016)).toBeCloseTo(0.016, 6);
    });

    it('accumulates elapsed across ticks', () => {
      const clock = new Clock();
      clock.tick(1000);
      clock.tick(1020);
      clock.tick(1050);
      expect(clock.elapsed).toBeCloseTo(0.05, 6); // 20ms + 30ms
    });
  });
});
