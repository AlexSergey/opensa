import { describe, expect, it } from 'vitest';

import { hasHdTwin } from './lod-twin';

describe('hasHdTwin', () => {
  describe('negative cases', () => {
    it('is false for a lod with no placed HD twin', () => {
      expect(hasHdTwin('lodlae2_roads89', new Set(['something_else']))).toBe(false);
    });

    it('is false when the stripped twin is itself a lod (not a real HD)', () => {
      expect(hasHdTwin('lodlodroad', new Set(['lodroad']))).toBe(false);
    });

    it('is false for a far-LOD whose HD is named unlike the lod (no prefix match)', () => {
      // SA's common case: the HD twin of `lodcuntw01` is `cuntwland03b`, which the prefix strip can't reach.
      expect(hasHdTwin('lodcuntw01', new Set(['cuntwland03b']))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('is true when stripping the "lod" prefix yields a placed non-lod model', () => {
      expect(hasHdTwin('lodlae2_roads89', new Set(['lae2_roads89']))).toBe(true);
    });

    it('is true when stripping a numbered "lodN" prefix yields a placed model', () => {
      expect(hasHdTwin('lod1blockk_lae', new Set(['blockk_lae']))).toBe(true);
    });
  });
});
