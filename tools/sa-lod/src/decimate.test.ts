import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { decimateMesh } from './decimate';

/** A flat z=0 grid (n×n verts) — a simple decimatable mesh. */
function flatGrid(n: number): MergedMesh {
  const positions: number[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      positions.push(x, y, 0);
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < n - 1; y += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const i = y * n + x;
      indices.push(i, i + 1, i + n + 1, i, i + n + 1, i + n);
    }
  }

  return {
    colors: new Uint8Array(n * n * 4),
    groups: [{ indices: Uint32Array.from(indices), texture: 'ground' }],
    normals: new Float32Array(n * n * 3),
    positions: Float32Array.from(positions),
    uvs: new Float32Array(n * n * 2),
  };
}

/** Longest edge over every triangle of a merged mesh. */
function maxEdge(mesh: MergedMesh): number {
  const p = mesh.positions;
  const len = (a: number, b: number): number =>
    Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  let m = 0;
  for (const group of mesh.groups) {
    for (let i = 0; i < group.indices.length; i += 3) {
      const [a, b, c] = [group.indices[i], group.indices[i + 1], group.indices[i + 2]];
      m = Math.max(m, len(a, b), len(b, c), len(c, a));
    }
  }

  return m;
}

const facesOf = (mesh: MergedMesh, texture: string): number =>
  (mesh.groups.find((g) => g.texture === texture)?.indices.length ?? 0) / 3;

describe('decimateMesh', () => {
  describe('negative cases', () => {
    it('returns the mesh unchanged when already under the triangle budget', () => {
      const mesh = flatGrid(3); // 8 triangles
      expect(decimateMesh(mesh, 100)).toBe(mesh);
    });
  });

  describe('positive cases', () => {
    it('decimates toward the triangle budget', () => {
      const tris = decimateMesh(flatGrid(12), 50).groups.reduce((sum, g) => sum + g.indices.length / 3, 0);
      expect(tris).toBeGreaterThan(0);
      expect(tris).toBeLessThan(242); // 11×11×2 input
    });

    it('caps edge growth so a flat surface does not sliver into spikes', () => {
      const input = maxEdge(flatGrid(12)); // longest input edge = the unit-cell diagonal
      // MAX_EDGE_FACTOR = 1.5 — a small allowance over the input's longest edge, never a long spike.
      expect(maxEdge(decimateMesh(flatGrid(12), 20))).toBeLessThanOrEqual(input * 1.5 + 1e-6);
    });

    it('keeps a small texture group alive instead of collapsing it to nothing', () => {
      // A big flat group plus a separate 2-triangle 'sign' island sharing the same budget pressure.
      const grid = flatGrid(10);
      const base = grid.positions.length / 3;
      const mesh: MergedMesh = {
        colors: new Uint8Array((base + 4) * 4),
        groups: [
          grid.groups[0],
          { indices: Uint32Array.of(base, base + 1, base + 2, base, base + 2, base + 3), texture: 'sign' },
        ],
        normals: new Float32Array((base + 4) * 3),
        positions: Float32Array.of(...grid.positions, 100, 0, 0, 101, 0, 0, 101, 1, 0, 100, 1, 0),
        uvs: new Float32Array((base + 4) * 2),
      };
      // Decimate hard — without the per-group floor the tiny island would be collapsed away.
      expect(facesOf(decimateMesh(mesh, 8), 'sign')).toBeGreaterThanOrEqual(2);
    });

    it('carries night colours through decimation when the mesh has them', () => {
      const mesh: MergedMesh = { ...flatGrid(12), nightColors: new Uint8Array(12 * 12 * 4).fill(40) };
      const out = decimateMesh(mesh, 50);
      expect(out.nightColors).toBeDefined();
      expect(out.nightColors).toHaveLength((out.positions.length / 3) * 4);
    });

    it('omits night colours when the mesh has none', () => {
      expect(decimateMesh(flatGrid(12), 50).nightColors).toBeUndefined();
    });
  });
});
