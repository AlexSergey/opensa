import { describe, expect, it } from 'vitest';

import { conditionPrelit } from './condition-prelit';

/** Build a prelit RGBA buffer from per-vertex [r,g,b,a] tuples. */
function prelit(vertices: [number, number, number, number][]): Uint8Array {
  return new Uint8Array(vertices.flat());
}

describe('conditionPrelit', () => {
  describe('negative cases', () => {
    it('leaves a healthy mid-range prelit untouched (returns null)', () => {
      expect(
        conditionPrelit(
          prelit([
            [150, 150, 150, 255],
            [120, 120, 120, 255],
          ]),
        ),
      ).toBeNull();
    });

    it('leaves dark-but-structured prelit alone (real baked shading, not flat black)', () => {
      // mean 20 (< 24) but spread 40 (> maxDarkSpread) → has shading → not washed out.
      expect(
        conditionPrelit(
          prelit([
            [0, 0, 0, 255],
            [40, 40, 40, 255],
          ]),
        ),
      ).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('lifts all-black prelit to the target, preserving alpha', () => {
      const out = conditionPrelit(
        prelit([
          [0, 0, 0, 64],
          [0, 0, 0, 200],
        ]),
        { targetLuma: 200 },
      )!;
      expect([...out.subarray(0, 4)]).toEqual([200, 200, 200, 64]); // RGB → target, alpha kept
      expect([...out.subarray(4, 8)]).toEqual([200, 200, 200, 200]);
    });

    it('lowers blown-white prelit toward the target, preserving alpha', () => {
      const out = conditionPrelit(prelit([[255, 255, 255, 17]]), { targetLuma: 200 })!;
      expect([...out]).toEqual([200, 200, 200, 17]);
    });

    it('lifts flat (uniform) dark-grey prelit to the target, preserving alpha', () => {
      // mean 10, spread 0 (≤ maxDarkSpread) → flat → delta +190 → uniform 200, alpha kept.
      const out = conditionPrelit(
        prelit([
          [10, 10, 10, 33],
          [10, 10, 10, 77],
        ]),
        { targetLuma: 200 },
      )!;
      expect([...out.subarray(0, 4)]).toEqual([200, 200, 200, 33]);
      expect([...out.subarray(4, 8)]).toEqual([200, 200, 200, 77]);
    });
  });
});
