import { describe, expect, it } from 'vitest';

import { simplify, type SimplifyMesh } from './simplify';

/** An N×N quad grid in the XY plane (2N² triangles), with UVs = the XY position. */
function grid(n: number): SimplifyMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let y = 0; y <= n; y += 1) {
    for (let x = 0; x <= n; x += 1) {
      positions.push(x, y, 0);
      uvs.push(x, y);
    }
  }
  const faces: number[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const v00 = y * (n + 1) + x;
      const v10 = v00 + 1;
      const v01 = v00 + (n + 1);
      const v11 = v01 + 1;
      faces.push(v00, v10, v11, v00, v11, v01);
    }
  }

  return {
    attributes: [{ data: Float64Array.from(uvs), size: 2 }],
    faceGroup: new Int32Array(faces.length / 3),
    faces: Int32Array.from(faces),
    positions: Float64Array.from(positions),
  };
}

describe('simplify', () => {
  describe('negative cases', () => {
    it('returns an empty mesh unchanged', () => {
      const result = simplify(
        { faceGroup: new Int32Array(0), faces: new Int32Array(0), positions: new Float64Array(0) },
        10,
      );
      expect(result.faces).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('reduces a flat grid toward the budget while staying within the original bounds', () => {
      const result = simplify(grid(8), 20); // 128 → ≤ ~20 triangles
      const faceCount = result.faces.length / 3;
      expect(faceCount).toBeLessThan(128);
      expect(faceCount).toBeGreaterThan(0);

      for (let i = 0; i < result.positions.length; i += 3) {
        expect(Number.isFinite(result.positions[i])).toBe(true);
        expect(result.positions[i]).toBeGreaterThanOrEqual(-0.01); // boundary pinned → inside [0,8]
        expect(result.positions[i]).toBeLessThanOrEqual(8.01);
      }
      expect(result.attributes[0].size).toBe(2);
      expect(result.attributes[0].data.length).toBe((result.positions.length / 3) * 2);
    });

    it('keeps every face index in range after compaction', () => {
      const result = simplify(grid(6), 15);
      const vertexCount = result.positions.length / 3;
      expect([...result.faces].every((v) => v >= 0 && v < vertexCount)).toBe(true);
    });

    it('caps edge growth on a flat surface when maxEdgeFactor is set', () => {
      const inputMaxEdge = Math.SQRT2; // unit grid → longest input edge is the quad diagonal
      const uncapped = maxEdge(simplify(grid(8), 8));
      const capped = maxEdge(simplify(grid(8), 8, { maxEdgeFactor: 1.5 }));
      expect(uncapped).toBeGreaterThan(inputMaxEdge * 1.5); // unbounded QEM slivers the flat grid into long edges
      expect(capped).toBeLessThanOrEqual(inputMaxEdge * 1.5 + 1e-9);
    });

    it('keeps a flat group alive with minFacesPerGroup that would otherwise collapse to nothing', () => {
      const mesh = grid(8);
      mesh.faceGroup = mesh.faceGroup.map((_, f) => (f < 6 ? 1 : 0)); // a small 6-face group within the flat grid
      const groupFaces = (r: { faceGroup: Int32Array }): number => [...r.faceGroup].filter((g) => g === 1).length;

      expect(groupFaces(simplify(mesh, 4))).toBeLessThan(2); // unbounded → the flat group is collapsed away
      expect(groupFaces(simplify(mesh, 4, { minFacesPerGroup: 2 }))).toBeGreaterThanOrEqual(2);
    });
  });
});

/** Longest edge over all faces of a simplify result. */
function maxEdge(result: { faces: Int32Array; positions: Float64Array }): number {
  const p = result.positions;
  const len = (a: number, b: number): number =>
    Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  let m = 0;
  for (let f = 0; f < result.faces.length; f += 3) {
    const [a, b, c] = [result.faces[f], result.faces[f + 1], result.faces[f + 2]];
    m = Math.max(m, len(a, b), len(b, c), len(c, a));
  }

  return m;
}
