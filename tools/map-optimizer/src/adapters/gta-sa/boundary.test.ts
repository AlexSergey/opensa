import { describe, expect, it } from 'vitest';

import type { Placement } from './boundary';

import { boundaryVertices, transformToWorld, worldToLocal } from './boundary';

const SQRT_HALF = Math.SQRT1_2; // sin/cos 45°

describe('worldToLocal', () => {
  describe('positive cases', () => {
    it('inverts transformToWorld under a translation', () => {
      const placement: Placement = { position: [5, 6, 7], rotation: [0, 0, 0, 1] };
      expect(worldToLocal(placement, transformToWorld(placement, [1, 2, 3]))).toEqual([1, 2, 3]);
    });

    it('inverts transformToWorld under a rotated placement (round-trip identity)', () => {
      const placement: Placement = { position: [-2, 3, 10], rotation: [0, 0, SQRT_HALF, SQRT_HALF] };
      const [x, y, z] = worldToLocal(placement, transformToWorld(placement, [1, 2, 3]));
      expect(x).toBeCloseTo(1, 6);
      expect(y).toBeCloseTo(2, 6);
      expect(z).toBeCloseTo(3, 6);
    });
  });
});

describe('boundaryVertices', () => {
  describe('positive cases', () => {
    it('returns the vertices on open edges (a single triangle: all three)', () => {
      expect([...boundaryVertices([{ a: 0, b: 1, c: 2 }])].sort()).toEqual([0, 1, 2]);
    });

    it('excludes the shared interior edge of two triangles forming a quad', () => {
      // Quad 0-1-2-3 split as (0,1,2)+(0,2,3): edge 0-2 is shared (interior); the outer ring 0,1,2,3 is boundary.
      const boundary = boundaryVertices([
        { a: 0, b: 1, c: 2 },
        { a: 0, b: 2, c: 3 },
      ]);
      expect([...boundary].sort()).toEqual([0, 1, 2, 3]);
    });
  });
});
