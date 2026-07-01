import { describe, expect, it } from 'vitest';

import type { SeamGeometry, SeamModel } from './seam-weld';

import { computeSeamOverrides, transformToWorld } from './seam-weld';

const SQRT_HALF = Math.SQRT1_2; // sin/cos 45°

function model(name: string, geometry: SeamGeometry, position: [number, number, number] = [0, 0, 0]): SeamModel {
  return { geometries: [geometry], name, placement: { position, rotation: [0, 0, 0, 1] } };
}

/** A single triangle (all 3 edges are boundary edges) in the XY plane; winding sets the +Z normal. */
function triangle(positions: number[], prelit: number[]): SeamGeometry {
  return { positions: new Float32Array(positions), prelit: new Uint8Array(prelit), triangles: [{ a: 0, b: 1, c: 2 }] };
}

// Two triangles sharing vertex 0 at world (0,0,0); both wound CCW in XY → +Z normals. Vertex 0 of A is grey
// 100, of B is grey 200 → the seam weld should average both to 150.
const A = triangle([0, 0, 0, 1, 0, 0, 0, 1, 0], [100, 100, 100, 255, 10, 10, 10, 255, 20, 20, 20, 255]);
const B = triangle([0, 0, 0, -1, 0, 0, 0, -1, 0], [200, 200, 200, 255, 30, 30, 30, 255, 40, 40, 40, 255]);

describe('transformToWorld', () => {
  describe('positive cases', () => {
    it('is position + point under the identity rotation', () => {
      expect(transformToWorld({ position: [5, 6, 7], rotation: [0, 0, 0, 1] }, [1, 2, 3])).toEqual([6, 8, 10]);
    });

    it('applies the CONJUGATE of the IPL quaternion (a +90° Z quat rotates (1,0,0) to (0,-1,0))', () => {
      const [x, y, z] = transformToWorld({ position: [0, 0, 0], rotation: [0, 0, SQRT_HALF, SQRT_HALF] }, [1, 0, 0]);
      expect(x).toBeCloseTo(0, 6);
      expect(y).toBeCloseTo(-1, 6);
      expect(z).toBeCloseTo(0, 6);
    });
  });
});

describe('computeSeamOverrides', () => {
  describe('negative cases', () => {
    it('welds nothing when only one model is present (a seam needs two)', () => {
      const { overrides, stats } = computeSeamOverrides([model('a', A)]);
      expect(overrides.size).toBe(0);
      expect(stats.welded).toBe(0);
    });

    it('skips a group whose luma spread exceeds maxLumaDelta (a level-normalisation case)', () => {
      const dark = triangle([0, 0, 0, 1, 0, 0, 0, 1, 0], [10, 10, 10, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
      const bright = triangle([0, 0, 0, -1, 0, 0, 0, -1, 0], [250, 250, 250, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
      const { overrides, stats } = computeSeamOverrides([model('a', dark), model('b', bright)]);
      expect(overrides.size).toBe(0);
      expect(stats.skippedSpread).toBe(1);
    });

    it('does not weld surfaces that touch but face away (the overpass-over-road guard)', () => {
      // B wound the other way → −Z normal; dot with A's +Z is −1 < cos45 → the coincident vertex is not welded.
      const flipped = triangle([0, 0, 0, 0, -1, 0, -1, 0, 0], [200, 200, 200, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
      const { stats } = computeSeamOverrides([model('a', A), model('b', flipped)]);
      expect(stats.welded).toBe(0);
    });

    it('does not weld vertices further apart than weldEpsilon', () => {
      const { stats } = computeSeamOverrides([model('a', A), model('b', B, [0.2, 0, 0])]);
      expect(stats.welded).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('averages the prelit RGB of two models coincident at a boundary vertex', () => {
      const { overrides, stats } = computeSeamOverrides([model('a', A), model('b', B)]);
      expect(stats.welded).toBe(1);
      expect(stats.modelsTouched).toBe(2);
      expect(overrides.get('a')).toEqual([{ pos: [0, 0, 0], rgb: [150, 150, 150] }]);
      expect(overrides.get('b')).toEqual([{ pos: [0, 0, 0], rgb: [150, 150, 150] }]);
    });
  });
});
