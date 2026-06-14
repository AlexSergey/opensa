import { describe, expect, it } from 'vitest';

import { MAX_ELEVATION, sunElevationAt } from './sun-position';

/** Euclidean length of a 3-vector. */
function length(dir: readonly [number, number, number]): number {
  return Math.hypot(dir[0], dir[1], dir[2]);
}

describe('sunElevationAt', () => {
  describe('negative cases', () => {
    it('is below the horizon at and before sunrise', () => {
      expect(sunElevationAt(6, 6, 20).elevation).toBeLessThan(0);
      expect(sunElevationAt(5, 6, 20)).toEqual({ dir: [0, -1, 0], elevation: -1 });
    });

    it('is below the horizon at and after sunset', () => {
      expect(sunElevationAt(20, 6, 20).elevation).toBeLessThan(0);
      expect(sunElevationAt(21, 6, 20)).toEqual({ dir: [0, -1, 0], elevation: -1 });
    });

    it('tracks a custom window — an hour inside the default window can be night in a narrower one', () => {
      expect(sunElevationAt(7, 6, 20).elevation).toBeGreaterThan(0); // day in [6,20]
      expect(sunElevationAt(7, 8, 18).elevation).toBeLessThan(0); // night in [8,18]
    });
  });

  describe('positive cases', () => {
    it('peaks at the window midpoint at MAX_ELEVATION', () => {
      const noon = sunElevationAt(13, 6, 20); // midpoint of [6,20]
      expect(noon.elevation).toBeCloseTo(MAX_ELEVATION, 6);
      expect(noon.dir[1]).toBeCloseTo(Math.sin(MAX_ELEVATION), 6); // straight up-ish (+Y)
    });

    it('moves the peak with the window (custom timecyc)', () => {
      // The peak follows the window's midpoint, wherever the window is set.
      expect(sunElevationAt(13, 8, 18).elevation).toBeCloseTo(MAX_ELEVATION, 6); // midpoint of [8,18]
      expect(sunElevationAt(15, 10, 20).elevation).toBeCloseTo(MAX_ELEVATION, 6); // midpoint of [10,20]
    });

    it('rises in the east in the morning, sets in the west in the evening', () => {
      expect(sunElevationAt(8, 6, 20).dir[0]).toBeGreaterThan(0); // morning → +X (east)
      expect(sunElevationAt(18, 6, 20).dir[0]).toBeLessThan(0); // evening → −X (west)
    });

    it('is symmetric about the window midpoint', () => {
      // Equal offsets either side of noon (13) give the same elevation.
      expect(sunElevationAt(10, 6, 20).elevation).toBeCloseTo(sunElevationAt(16, 6, 20).elevation, 6);
    });

    it('returns a unit direction while the sun is up', () => {
      for (const hour of [7, 10, 13, 16, 19]) {
        expect(length(sunElevationAt(hour, 6, 20).dir)).toBeCloseTo(1, 6);
      }
    });

    it('honours a custom max elevation', () => {
      const half = sunElevationAt(13, 6, 20, MAX_ELEVATION / 2);
      expect(half.elevation).toBeCloseTo(MAX_ELEVATION / 2, 6);
    });
  });
});
