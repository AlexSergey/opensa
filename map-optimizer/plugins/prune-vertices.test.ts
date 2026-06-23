import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../core/ir';

import { pruneMesh } from './prune-vertices';

function mesh(overrides: Partial<SubMesh>): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array(),
    prelitColors: null,
    triangles: [],
    uvs: null,
    ...overrides,
  };
}

describe('pruneMesh', () => {
  describe('negative cases', () => {
    it('is a no-op (returns 0) when every vertex is referenced', () => {
      const m = mesh({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        triangles: [{ a: 0, b: 1, c: 2, material: 0 }],
      });
      expect(pruneMesh(m)).toBe(0);
      expect(m.positions.length / 3).toBe(3);
    });
  });

  describe('positive cases', () => {
    it('drops an unreferenced vertex and keeps attributes aligned + triangles re-indexed', () => {
      // 4 vertices; vertex index 1 (the middle one) is unused.
      const m = mesh({
        normals: new Float32Array([1, 0, 0, 9, 9, 9, 0, 1, 0, 0, 0, 1]),
        positions: new Float32Array([0, 0, 0, 5, 5, 5, 1, 0, 0, 0, 1, 0]),
        triangles: [{ a: 0, b: 2, c: 3, material: 0 }],
      });

      expect(pruneMesh(m)).toBe(1);
      expect(m.positions.length / 3).toBe(3);
      // surviving vertices are old 0, 2, 3 in order
      expect([...m.positions]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      expect([...m.normals!]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      expect(m.triangles[0]).toEqual({ a: 0, b: 1, c: 2, material: 0 });
    });
  });
});
