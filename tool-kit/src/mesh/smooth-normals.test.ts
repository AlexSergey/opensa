import { describe, expect, it } from 'vitest';

import { rebuildSmoothNormals } from './smooth-normals';

describe('rebuildSmoothNormals', () => {
  describe('negative cases', () => {
    it('returns null with no triangles', () => {
      expect(rebuildSmoothNormals(new Float32Array(9), new Uint32Array(0))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('leaves a flat quad un-split with one consistent normal', () => {
      // Two coplanar triangles in the XY plane (winding → +Z).
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 2, 3])!;
      expect(result.splitSources).toEqual([]); // one smooth group → no split
      expect([...result.indices]).toEqual([0, 1, 2, 0, 2, 3]); // indices unchanged
      expect([...result.normals.slice(0, 3)]).toEqual([0, 0, 1]);
    });

    it('splits the shared edge of a 90° crease (sharper than 45°)', () => {
      // Two triangles sharing edge A–B: one flat (XY), one vertical — dihedral 90° > crease.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 1, 3])!;
      expect(result.splitSources).toEqual([0, 1]); // A and B each split into a second copy
      expect(result.normals).toHaveLength((4 + 2) * 3); // 4 originals + 2 appended
    });
  });
});
