import { describe, expect, it } from 'vitest';

import { WIND_MODELS } from './wind-mode';

describe('WIND_MODELS', () => {
  describe('positive cases', () => {
    it('is a non-empty set of sway-trigger model names', () => {
      expect(WIND_MODELS.size).toBeGreaterThan(100);
    });

    it('stores every name lowercased and trimmed (lookups key off the lowercased model name)', () => {
      for (const name of WIND_MODELS) {
        expect(name).toBe(name.toLowerCase());
        expect(name).toBe(name.trim());
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it('includes representative vegetation the wind mod adapts', () => {
      expect(WIND_MODELS.has('gen_tallgrsnew')).toBe(true); // grass
      expect(WIND_MODELS.has('veg_palm01')).toBe(true); // palm
      expect(WIND_MODELS.has('cedar1_po')).toBe(true); // tree
    });
  });
});
