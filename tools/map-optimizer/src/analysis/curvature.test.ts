import { describe, expect, it } from 'vitest';

import { scanGeometry } from './curvature';

const tri = (a: number, b: number, c: number): { a: number; b: number; c: number; material: number } => ({
  a,
  b,
  c,
  material: 0,
});

describe('scanGeometry', () => {
  describe('negative cases', () => {
    it('reports a flat quad as all-flat with nothing to refine', () => {
      // Two big coplanar triangles in the z=0 plane sharing the diagonal.
      const positions = new Float32Array([0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0]);
      const metrics = scanGeometry(positions, [tri(0, 1, 2), tri(0, 2, 3)]);
      expect(metrics.edges.gentle).toBe(0);
      expect(metrics.edges.crease).toBe(0);
      expect(metrics.edges.flat).toBe(1); // the shared diagonal
      expect(metrics.refineCandidates).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('classifies a steep hinge as a crease (kept sharp, not a refine target)', () => {
      // Two triangles sharing edge (0,0,0)-(0,1,0): one in z=0, one in x=0 → 90° dihedral.
      const positions = new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1]);
      const metrics = scanGeometry(positions, [tri(0, 1, 2), tri(0, 1, 3)]);
      expect(metrics.edges.crease).toBe(1);
      expect(metrics.edges.gentle).toBe(0);
      expect(metrics.refineCandidates).toBe(0);
    });

    it('flags large, gently-curved triangles as refine candidates', () => {
      // Shared edge (0,0,0)-(0,3,0); the second triangle tilts up by 1 → ~18° fold, both areas > 4.
      const positions = new Float32Array([0, 0, 0, 0, 3, 0, 3, 0, 0, 3, 0, 1]);
      const metrics = scanGeometry(positions, [tri(0, 1, 2), tri(0, 1, 3)]);
      expect(metrics.edges.gentle).toBe(1);
      expect(metrics.largeTriangles).toBe(2);
      expect(metrics.refineCandidates).toBe(2);
    });

    it('welds seam-split vertices so a shared edge is not seen as two boundaries', () => {
      // Same flat quad, but the second triangle uses duplicate vertices at identical positions.
      const positions = new Float32Array([0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 0, 0, 4, 4, 0, 0, 4, 0]);
      const metrics = scanGeometry(positions, [tri(0, 1, 2), tri(3, 4, 5)]);
      expect(metrics.edges.flat).toBe(1); // welded diagonal, not 2 boundary edges
      expect(metrics.edges.boundary).toBe(4);
    });
  });
});
