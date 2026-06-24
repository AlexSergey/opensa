import { describe, expect, it } from 'vitest';

import type { Triangle } from '../core/ir';

import { recomputeNormals } from './recompute-normals';

const tri = (a: number, b: number, c: number): Triangle => ({ a, b, c, material: 0 });

function expectClose(actual: [number, number, number], expected: [number, number, number]): void {
  for (let i = 0; i < 3; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i], 5);
  }
}

function normalAt(normals: Float32Array, vertex: number): [number, number, number] {
  return [normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]];
}

describe('recomputeNormals', () => {
  describe('negative cases', () => {
    it('skips degenerate (zero-area) faces and keeps the existing normal there', () => {
      // One real triangle (0,1,2) + a degenerate one (3,3,4); vertex 3 is only used by the degenerate face.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5, 6, 6, 6]);
      const existing = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0, 0, 0]);

      const out = recomputeNormals(positions, [tri(0, 1, 2), tri(3, 3, 4)], existing);

      expectClose(normalAt(out, 0), [0, 0, 1]);
      expectClose(normalAt(out, 3), [0.5, 0.5, 0.5]); // unchanged — kept from `existing`
    });
  });

  describe('positive cases', () => {
    it('smooths a flat quad to a single face normal', () => {
      // A(0,0,0) B(1,0,0) C(1,1,0) D(0,1,0) — two CCW triangles in the XY plane → +Z.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
      const existing = new Float32Array(12);

      const out = recomputeNormals(positions, [tri(0, 1, 2), tri(0, 2, 3)], existing);

      for (let v = 0; v < 4; v += 1) {
        expectClose(normalAt(out, v), [0, 0, 1]);
      }
    });

    it('welds a duplicated seam edge so the split vertices share one smooth normal', () => {
      // Two coplanar tris that DO NOT share indices: tri2 re-duplicates A and C (verts 3 and 4).
      const positions = new Float32Array([
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        1,
        0, // 0 A, 1 B, 2 C  (tri 0,1,2)
        0,
        0,
        0,
        1,
        1,
        0,
        0,
        1,
        0, // 3 A', 4 C', 5 D (tri 3,4,5)
      ]);
      const existing = new Float32Array(positions.length);

      const out = recomputeNormals(positions, [tri(0, 1, 2), tri(3, 4, 5)], existing);

      expectClose(normalAt(out, 3), [0, 0, 1]); // A' welds with A → smoothed across the seam
      expectClose(normalAt(out, 4), [0, 0, 1]); // C' welds with C
    });

    it('gives a vertex shared by opposite-winding faces a real normal, not zero (sliver guard)', () => {
      // Coincident double-sided panel — the same triangle wound both ways → the angle-weighted reference
      // cancels to zero. The vertex must still get the panel's ±Z face normal, never [0,0,0].
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const existing = new Float32Array(positions.length);

      const normal = normalAt(recomputeNormals(positions, [tri(0, 1, 2), tri(0, 2, 1)], existing), 0);

      expect(Math.hypot(...normal)).toBeCloseTo(1, 5); // unit length, not the old zero fallback
      expect(Math.abs(normal[2])).toBeCloseTo(1, 5); // the panel's own face direction
    });

    it('keeps a hard edge: 90° faces sharing a split edge keep their own-side normals', () => {
      // Face1 in XY (+Z): A,B,C. Face2 in XZ (-Y): A2,B2,C2 — A2==A, B2==B by position (split).
      const positions = new Float32Array([
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        1,
        0, // 0 A, 1 B, 2 C   → +Z
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        1, // 3 A2, 4 B2, 5 C2 → -Y
      ]);
      const existing = new Float32Array(positions.length);

      const out = recomputeNormals(positions, [tri(0, 1, 2), tri(3, 4, 5)], existing, { creaseAngleDeg: 45 });

      expectClose(normalAt(out, 0), [0, 0, 1]); // A (face1 side) stays +Z, not averaged toward -Y
      expectClose(normalAt(out, 3), [0, -1, 0]); // A2 (face2 side) stays -Y
    });
  });
});
