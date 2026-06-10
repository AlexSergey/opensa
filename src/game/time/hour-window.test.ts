import { describe, expect, it } from 'vitest';

import { inHourWindow, nightHourFactor } from './hour-window';

describe('inHourWindow', () => {
  describe('negative cases', () => {
    it('returns false before a non-wrapping window opens', () => {
      expect(inHourWindow(5, 8, 18)).toBe(false);
    });

    it('returns false inside the daytime gap of a midnight-wrapping window', () => {
      expect(inHourWindow(12, 20, 6)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('returns true inside a non-wrapping window', () => {
      expect(inHourWindow(10, 8, 18)).toBe(true);
    });

    it('returns true across midnight for a wrapping window', () => {
      expect(inHourWindow(2, 20, 6)).toBe(true);
    });

    it('is always true for a degenerate window', () => {
      expect(inHourWindow(13, 6, 6)).toBe(true);
    });
  });
});

describe('nightHourFactor', () => {
  describe('negative cases', () => {
    it('is 0 in broad daylight (outside the night window)', () => {
      expect(nightHourFactor(12, 20, 21, 6, 7)).toBe(0);
    });

    it('is 0 once the dawn fade has completed', () => {
      expect(nightHourFactor(7, 20, 21, 6, 7)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('is 1 across the overnight core', () => {
      expect(nightHourFactor(2, 20, 21, 6, 7)).toBe(1);
    });

    it('ramps 0→1 through the dusk fade-in', () => {
      expect(nightHourFactor(20.5, 20, 21, 6, 7)).toBeCloseTo(0.5);
    });

    it('ramps 1→0 through the dawn fade-out', () => {
      expect(nightHourFactor(6.5, 20, 21, 6, 7)).toBeCloseTo(0.5);
    });
  });
});
