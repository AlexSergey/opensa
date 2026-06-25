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
  });
});
