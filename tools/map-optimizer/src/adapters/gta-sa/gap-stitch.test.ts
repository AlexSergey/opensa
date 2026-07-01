import { describe, expect, it } from 'vitest';

import type { GapModel } from './gap-stitch';

import { computeGapStitches } from './gap-stitch';

const TRIS = [
  { a: 0, b: 1, c: 2 },
  { a: 0, b: 2, c: 3 },
]; // a quad, wound CCW in XY → +Z normals; all four edges are open (boundary)

/** A unit quad at world x-origin `x0`, in the XY plane. */
function quad(name: string, x0: number): GapModel {
  return {
    geometries: [{ positions: new Float32Array([x0, 0, 0, x0 + 1, 0, 0, x0 + 1, 1, 0, x0, 1, 0]), triangles: TRIS }],
    name,
    placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  };
}

describe('computeGapStitches', () => {
  describe('negative cases', () => {
    it('stitches nothing with a single model (a crack needs two)', () => {
      const { stats } = computeGapStitches([quad('a', 0)]);
      expect(stats.stitched + stats.tjunctions).toBe(0);
    });

    it('A/B leave a gap wider than maxGap alone (that is variant D’s job)', () => {
      const { stats } = computeGapStitches([quad('a', 0), quad('b', 1.5)], { maxGap: 0.4, skirtDepth: 0 });
      expect(stats.stitched + stats.tjunctions).toBe(0);
    });

    it('leaves an already-coincident edge alone (≤ minGap → the seam weld’s job)', () => {
      const { stats } = computeGapStitches([quad('a', 0), quad('b', 1)], { minGap: 0.05, skirtDepth: 0 });
      expect(stats.stitched + stats.tjunctions).toBe(0);
    });

    it('D: does not skirt when the neighbour is beyond skirtMaxGap (an open ledge over air)', () => {
      const { stats } = computeGapStitches([quad('a', 0), quad('b', 5)], { skirtMaxGap: 3 });
      expect(stats.skirted).toBe(0);
    });

    it('D: does not skirt a vertical drop (neighbour below by more than skirtMaxRise → not a coplanar seam)', () => {
      // 1.8 in X (within skirtMaxGap) but 1.5 down in Z (> skirtMaxRise) → a cliff, not a ground seam.
      const low: GapModel = {
        geometries: [
          { positions: new Float32Array([1.8, 0, -1.5, 2.8, 0, -1.5, 2.8, 1, -1.5, 1.8, 1, -1.5]), triangles: TRIS },
        ],
        name: 'b',
        placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      };
      expect(computeGapStitches([quad('a', 0), low], { skirtMaxRise: 1 }).stats.skirted).toBe(0);
    });

    it('does not stitch surfaces that touch but face away (normal guard)', () => {
      const flipped: GapModel = {
        geometries: [{ positions: new Float32Array([1.2, 0, 0, 1.2, 1, 0, 2.2, 1, 0, 2.2, 0, 0]), triangles: TRIS }],
        name: 'b',
        placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      };
      expect(computeGapStitches([quad('a', 0), flipped]).stats.stitched).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('A: moves the two mutual-nearest boundary pairs across a 0.25 gap to the midline (no seam collapse)', () => {
      // A right edge x=1, B left edge x=1.25 → gap 0.25. The two facing corner pairs meet at x=1.125 (exact in
      // float32); the seam's two vertices land at (1.125,0) and (1.125,1) — distinct, not collapsed to a point.
      const { moves, stats } = computeGapStitches([quad('a', 0), quad('b', 1.25)], {
        maxGap: 0.4,
        minGap: 0.05,
        skirtDepth: 0,
      });

      expect(stats.stitched).toBe(2);
      expect(moves.get('a')).toEqual(
        expect.arrayContaining([
          { newPos: [1.125, 0, 0], pos: [1, 0, 0] },
          { newPos: [1.125, 1, 0], pos: [1, 1, 0] },
        ]),
      );
      expect(moves.get('b')).toEqual(
        expect.arrayContaining([
          { newPos: [1.125, 0, 0], pos: [1.25, 0, 0] },
          { newPos: [1.125, 1, 0], pos: [1.25, 1, 0] },
        ]),
      );
    });

    it('B: a vertex landing on the interior of another model’s edge snaps onto it and splits that edge', () => {
      // A is a 1×2 quad; its right edge runs (1,0)→(1,2). B is a triangle whose tip (1.25,1) has no near A vertex
      // (corners are >1 unit away) but projects onto that edge at t=0.5, perp 0.25 → a T-junction, not an A weld.
      const a: GapModel = {
        geometries: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 2, 0]), triangles: TRIS }],
        name: 'a',
        placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      };
      const b: GapModel = {
        geometries: [
          { positions: new Float32Array([1.25, 1, 0, 2, 0.5, 0, 2, 1.5, 0]), triangles: [{ a: 0, b: 1, c: 2 }] },
        ],
        name: 'b',
        placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      };
      const { moves, splits, stats } = computeGapStitches([a, b], { maxGap: 0.4, minGap: 0.05, skirtDepth: 0 });

      expect(stats.stitched).toBe(0);
      expect(stats.tjunctions).toBe(1);
      expect(moves.get('b')).toEqual([{ newPos: [1, 1, 0], pos: [1.25, 1, 0] }]); // B's tip snaps onto A's edge
      expect(splits.get('a')).toEqual([
        {
          edge: [
            [1, 0, 0],
            [1, 2, 0],
          ],
          t: 0.5,
        },
      ]); // A's edge is split at the point
      expect(splits.has('b')).toBe(false);
    });

    it('D: extrudes a downward skirt on a wide-gap horizontal edge facing a coplanar neighbour', () => {
      // Two horizontal quads 1 unit apart (> maxGap, ≤ skirtMaxGap), same height → A's facing right edge skirts
      // down by skirtDepth along its (up) normal; the non-facing edges (neighbour off to the side) do not.
      const { skirts, stats } = computeGapStitches([quad('a', 0), quad('b', 2)], { skirtDepth: 1.5, skirtMaxGap: 3 });

      expect(stats.skirted).toBeGreaterThan(0);
      expect(skirts.get('a')).toEqual(
        expect.arrayContaining([{ a: [1, 0, 0], b: [1, 1, 0], belowA: [1, 0, -1.5], belowB: [1, 1, -1.5] }]),
      );
      expect(skirts.get('a')!.some((s) => s.a[0] === 0)).toBe(false); // A's far (left) edge is not skirted
    });
  });
});
