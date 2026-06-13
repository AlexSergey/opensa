import { describe, expect, it } from 'vitest';

import { cloudProfile } from './cloud-profile';

describe('cloudProfile', () => {
  describe('negative cases', () => {
    it('falls back to the default profile for an unmatched weather (e.g. rain/storm)', () => {
      expect(cloudProfile('RAIN')).toEqual({ coverage: 0.5, darkness: 0.3 });
    });
  });

  describe('positive cases', () => {
    it('matches EXTRASUNNY before SUNNY (substring order)', () => {
      expect(cloudProfile('EXTRASUNNY')).toEqual({ coverage: 0.14, darkness: 0 });
      expect(cloudProfile('SUNNY')).toEqual({ coverage: 0.32, darkness: 0.06 });
    });

    it('maps the cloudy and foggy families', () => {
      expect(cloudProfile('CLOUDY')).toEqual({ coverage: 1, darkness: 0.9 });
      expect(cloudProfile('FOGGY')).toEqual({ coverage: 0.8, darkness: 0.2 });
    });

    it('adds a haze bump for SMOG variants on top of the base profile', () => {
      // EXTRASUNNY_SMOG = EXTRASUNNY base (0.14/0) + SMOG bump (0.08/0.06).
      expect(cloudProfile('EXTRASUNNY_SMOG')).toEqual({ coverage: 0.14 + 0.08, darkness: 0.06 });
    });

    it('clamps the smog bump to 1', () => {
      const profile = cloudProfile('CLOUDY_SMOG'); // 1 + 0.08 → clamp 1 ; 0.9 + 0.06 → 0.96
      expect(profile.coverage).toBe(1);
      expect(profile.darkness).toBeCloseTo(0.96, 5);
    });
  });
});
