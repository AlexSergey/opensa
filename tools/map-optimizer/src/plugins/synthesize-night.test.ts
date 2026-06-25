import { describe, expect, it } from 'vitest';

import { synthesizeNight } from './synthesize-night';

/** Build a prelit RGBA buffer from per-vertex [r,g,b,a] tuples. */
function prelit(vertices: [number, number, number, number][]): Uint8Array {
  return new Uint8Array(vertices.flat());
}

describe('synthesizeNight', () => {
  describe('negative cases', () => {
    it('returns null when the model is too dark by day (mean luma ≤ minLuma)', () => {
      expect(synthesizeNight(prelit([[20, 20, 20, 255]]), { minLuma: 32 })).toBeNull();
    });

    it('returns null when any day-prelit alpha is overloaded (< 255 → wind / floodlight)', () => {
      expect(synthesizeNight(prelit([[200, 200, 200, 128]]))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('copies the day prelit verbatim (nightScale 1), forcing opaque alpha', () => {
      const out = synthesizeNight(prelit([[100, 150, 200, 255]]), { nightScale: 1 })!;
      expect([...out]).toEqual([100, 150, 200, 255]);
    });

    it('scales the copied RGB by nightScale, clamping', () => {
      const out = synthesizeNight(prelit([[100, 200, 250, 255]]), { nightScale: 0.5 })!;
      expect([...out]).toEqual([50, 100, 125, 255]);
    });
  });
});
