import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../core/ir';

import { rebuildSmoothNormals } from './smooth-normals';

function mesh(positions: number[], triangles: [number, number, number][]): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles: triangles.map(([a, b, c]) => ({ a, b, c, material: 0 })),
    uvs: null,
  };
}

function normalAt(normals: Float32Array | null, v: number): [number, number, number] {
  return [normals![v * 3], normals![v * 3 + 1], normals![v * 3 + 2]];
}

describe('rebuildSmoothNormals', () => {
  describe('negative cases', () => {
    it('returns null for an empty mesh', () => {
      expect(rebuildSmoothNormals(mesh([], []))).toBeNull();
    });

    it('does not split a flat quad — one smooth group, one normal per vertex', () => {
      const flat = mesh(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        [
          [0, 1, 2],
          [0, 2, 3],
        ],
      );
      const out = rebuildSmoothNormals(flat)!;
      expect(out.positions.length / 3).toBe(4); // no split
      for (let v = 0; v < 4; v += 1) {
        expect(normalAt(out.normals, v)).toEqual([0, 0, 1]);
      }
    });
  });

  describe('positive cases', () => {
    it('splits a shared 90° corner so each wall keeps its own flat normal', () => {
      // Vertices 0,1 are shared by both faces; the hinge edge (0,1) is 90° → two groups → 0,1 split.
      const hinge = mesh(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
        [
          [0, 1, 2],
          [0, 1, 3],
        ],
      );
      const out = rebuildSmoothNormals(hinge)!;
      expect(out.positions.length / 3).toBe(6); // 4 → 6 (0 and 1 each duplicated)
      expect(normalAt(out.normals, out.triangles[0].a)).toEqual([0, 0, 1]); // +Z wall
      expect(normalAt(out.normals, out.triangles[1].a)).toEqual([0, -1, 0]); // -Y wall
    });

    it('handles a double face: opposite-wound coincident triangles get opposite normals', () => {
      const doubleFace = mesh(
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        [
          [0, 1, 2],
          [0, 2, 1],
        ],
      );
      const out = rebuildSmoothNormals(doubleFace)!;
      expect(out.positions.length / 3).toBe(6); // every vertex split between the two sides
      expect(normalAt(out.normals, out.triangles[0].a)).toEqual([0, 0, 1]);
      expect(normalAt(out.normals, out.triangles[1].a)).toEqual([0, 0, -1]);
    });
  });
});
