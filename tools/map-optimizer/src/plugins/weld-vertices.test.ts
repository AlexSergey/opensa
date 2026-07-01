import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../core/ir';

import { weldMesh } from './weld-vertices';

function mesh(positions: number[], triangles: SubMesh['triangles']): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles,
    uvs: null,
  };
}

describe('weldMesh', () => {
  describe('negative cases', () => {
    it('is a no-op (returns 0) when every vertex is distinct', () => {
      const m = mesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [{ a: 0, b: 1, c: 2, material: 0 }]);
      expect(weldMesh(m)).toBe(0);
      expect(m.positions.length / 3).toBe(3);
    });

    it('keeps vertices that share layer 0 but differ in a second UV layer', () => {
      // Vertex 3 duplicates vertex 0 in position + layer-0 UV, but its layer-1 UV differs → must NOT merge.
      const m = mesh(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
        [
          { a: 0, b: 1, c: 2, material: 0 },
          { a: 3, b: 2, c: 1, material: 0 },
        ],
      );
      m.uvs = new Float32Array([0, 0, 0.5, 0, 0, 0.5, 0, 0]);
      m.extraUvs = [new Float32Array([0, 0, 0.5, 0, 0, 0.5, 0.9, 0.9])];
      expect(weldMesh(m)).toBe(0);
      expect(m.positions.length / 3).toBe(4);
    });
  });

  describe('positive cases', () => {
    it('merges a fully-identical duplicate vertex and re-indexes triangles', () => {
      // Vertex 3 duplicates vertex 0 exactly; two triangles reference both.
      const m = mesh(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0],
        [
          { a: 0, b: 1, c: 2, material: 0 },
          { a: 3, b: 2, c: 1, material: 0 },
        ],
      );

      expect(weldMesh(m)).toBe(1);
      expect(m.positions.length / 3).toBe(3);
      expect(m.triangles[1]).toEqual({ a: 0, b: 2, c: 1, material: 0 });
    });
  });
});
