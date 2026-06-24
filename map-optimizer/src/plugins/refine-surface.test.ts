import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../core/ir';

import { refineSubMesh } from './refine-surface';

function mesh(positions: number[], triangles: [number, number, number][], prelit?: number[]): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array(positions),
    prelitColors: prelit ? new Uint8Array(prelit) : null,
    triangles: triangles.map(([a, b, c]) => ({ a, b, c, material: 0 })),
    uvs: null,
  };
}

describe('refineSubMesh', () => {
  describe('negative cases', () => {
    it('returns null for a flat quad (no curvature to refine)', () => {
      const flat = mesh(
        [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 4, 0],
        [
          [0, 1, 2],
          [0, 2, 3],
        ],
      );
      expect(refineSubMesh(flat)).toBeNull();
    });

    it('returns null for a hard crease (kept sharp, never rounded)', () => {
      const crease = mesh(
        [0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1],
        [
          [0, 1, 2],
          [0, 1, 3],
        ],
      );
      expect(refineSubMesh(crease)).toBeNull();
    });
  });

  describe('positive cases', () => {
    // One level + a small area target keep the counts exact, independent of the production defaults.
    const once = { areaThreshold: 1, maxLevels: 1 };

    it('splits the shared gentle edge and bisects both triangles (1→2 each), adding one welded midpoint', () => {
      // Two large triangles sharing edge (0,1); the second tilts up by 1 → ~18° fold.
      const fold = mesh(
        [0, 0, 0, 0, 3, 0, 3, 0, 0, 3, 0, 1],
        [
          [0, 1, 2],
          [0, 1, 3],
        ],
      );
      const refined = refineSubMesh(fold, once)!;
      expect(refined.triangles.length).toBe(4); // 2 → 4
      expect(refined.positions.length).toBe(5 * 3); // 4 originals + 1 shared midpoint (deduped)
    });

    it('leaves the four boundary edges unsplit (only the interior edge refines)', () => {
      const fold = mesh(
        [0, 0, 0, 0, 3, 0, 3, 0, 0, 3, 0, 1],
        [
          [0, 1, 2],
          [0, 1, 3],
        ],
      );
      // A single new vertex proves only the one interior edge was touched, not the boundary.
      expect(refineSubMesh(fold, once)!.positions.length / 3).toBe(5);
    });

    it('interpolates the midpoint prelit from its two edge endpoints', () => {
      const prelit = [10, 20, 30, 255, 50, 60, 70, 255, 0, 0, 0, 255, 0, 0, 0, 255];
      const fold = mesh(
        [0, 0, 0, 0, 3, 0, 3, 0, 0, 3, 0, 1],
        [
          [0, 1, 2],
          [0, 1, 3],
        ],
        prelit,
      );
      const midpoint = refineSubMesh(fold, once)!.prelitColors!.subarray(4 * 4, 5 * 4);
      expect([...midpoint]).toEqual([30, 40, 50, 255]); // mean of vertex 0 and vertex 1
    });
  });
});
