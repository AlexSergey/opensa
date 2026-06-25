import { describe, expect, it } from 'vitest';

import type { Triangle } from '../core/ir';

import { removeDegenerateTriangles } from './degenerate-triangles';

const tri = (a: number, b: number, c: number): Triangle => ({ a, b, c, material: 0 });

// Vertices: 0,1,2 form a unit right triangle; 3 == position of 0 (coincident); 4 sits between 0 and 1
// (collinear with them); 5 is slightly off the 0-1 line (a thin but valid triangle).
const positions = new Float32Array([
  0,
  0,
  0, // 0
  1,
  0,
  0, // 1
  0,
  1,
  0, // 2
  0,
  0,
  0, // 3 (coincident with 0)
  0.5,
  0,
  0, // 4 (on the 0-1 segment)
  0.5,
  0.01,
  0, // 5 (just off it)
]);

describe('removeDegenerateTriangles', () => {
  describe('negative cases', () => {
    it('keeps a normal, non-degenerate face', () => {
      expect(removeDegenerateTriangles(positions, [tri(0, 1, 2)])).toEqual([tri(0, 1, 2)]);
    });

    it('keeps a thin but non-zero-area face', () => {
      expect(removeDegenerateTriangles(positions, [tri(0, 1, 5)])).toEqual([tri(0, 1, 5)]);
    });
  });

  describe('positive cases', () => {
    it('removes an equal-index (zero edge) triangle', () => {
      expect(removeDegenerateTriangles(positions, [tri(0, 0, 1)])).toEqual([]);
    });

    it('removes a triangle with coincident corners (distinct indices, same position)', () => {
      expect(removeDegenerateTriangles(positions, [tri(0, 3, 1)])).toEqual([]);
    });

    it('removes a collinear (zero-area) triangle', () => {
      expect(removeDegenerateTriangles(positions, [tri(0, 4, 1)])).toEqual([]);
    });

    it('drops only the degenerate faces from a mixed list', () => {
      expect(removeDegenerateTriangles(positions, [tri(0, 1, 2), tri(0, 0, 1), tri(0, 1, 5)])).toEqual([
        tri(0, 1, 2),
        tri(0, 1, 5),
      ]);
    });
  });
});
