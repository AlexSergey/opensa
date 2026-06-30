import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { encodeLodDff } from './encode-dff';

/** A unit quad (4 verts, 2 tris) split across two texture groups. */
function sampleMesh(): MergedMesh {
  return {
    colors: Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]),
    groups: [
      { indices: Uint32Array.of(0, 1, 2), texture: 'road' },
      { indices: Uint32Array.of(0, 2, 3), texture: 'grass' },
    ],
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

/** A mesh of `n` disconnected triangles (3n vertices) in one group — used to exceed the u16 vertex limit. */
function triangleSoup(n: number): MergedMesh {
  const positions = new Float32Array(n * 9);
  const indices = new Uint32Array(n * 3);
  for (let t = 0; t < n; t += 1) {
    positions[t * 9] = t;
    positions[t * 9 + 3] = t + 1;
    positions[t * 9 + 6] = t;
    positions[t * 9 + 7] = 1;
    indices[t * 3] = t * 3;
    indices[t * 3 + 1] = t * 3 + 1;
    indices[t * 3 + 2] = t * 3 + 2;
  }

  return {
    colors: new Uint8Array(n * 12).fill(255),
    groups: [{ indices, texture: 'soup' }],
    normals: new Float32Array(n * 9),
    positions,
    uvs: new Float32Array(n * 6),
  };
}

describe('encodeLodDff', () => {
  describe('positive cases', () => {
    it('splits a mesh exceeding the u16 vertex limit across multiple atomics', () => {
      const n = 30000; // 90 000 verts > 65 535 → must split
      const clump = parseDff(toArrayBuffer(encodeLodDff(triangleSoup(n), 'lod_big')));
      expect(clump.atomics.length).toBeGreaterThan(1);
      expect(clump.geometries.length).toBe(clump.atomics.length);
      expect(clump.geometries.every((g) => g.positions.length / 3 <= 0xffff)).toBe(true);
      const tris = clump.geometries.reduce((s, g) => s + g.triangles.length, 0);
      expect(tris).toBe(n); // single-sided by default — every source triangle once, across all chunks
    });

    it('round-trips through the engine parser, single-sided by default, geometry/materials/prelit intact', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_3_-7')));
      expect(clump.atomics).toHaveLength(1);
      expect(clump.frames).toHaveLength(1);
      expect(clump.frames[0].name).toBe('lod_3_-7');

      const geometry = clump.geometries[0];
      expect(geometry.positions).toHaveLength(12);
      expect(geometry.triangles).toHaveLength(2); // single-sided default — each of the 2 source tris emitted once
      expect(geometry.prelitColors).not.toBeNull();
      expect(geometry.uvLayers[0]).toHaveLength(8);
      expect(geometry.materials.map((m) => m.texture?.name)).toEqual(['road', 'grass']);
    });

    it('assigns each triangle to its texture group via the BinMesh split', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_cell')));
      const materials = clump.geometries[0].triangles.map((t) => t.materialIndex).sort();
      expect(materials).toEqual([0, 1]); // one triangle per group, single-sided
    });

    it('emits geometry two-sided when doubleSided — each source triangle plus its reversed copy', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_cell', { doubleSided: true })));
      expect(clump.geometries[0].triangles).toHaveLength(4); // 2 source tris, both windings
      const tris = clump.geometries[0].triangles.filter((t) => t.materialIndex === 0);
      // source (0,1,2) and its reverse (0,2,1) — same vertices, opposite winding.
      expect(tris.map((t) => [t.a, t.b, t.c])).toEqual([
        [0, 1, 2],
        [0, 2, 1],
      ]);
    });

    it('writes the night-colour plugin (round-trips) when the mesh carries night colours', () => {
      const night = Uint8Array.from([200, 210, 220, 255, 1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255]);
      const clump = parseDff(toArrayBuffer(encodeLodDff({ ...sampleMesh(), nightColors: night }, 'lod_3_-7')));
      expect([...(clump.geometries[0].nightColors ?? [])]).toEqual([...night]);
    });

    it('omits the night plugin when the mesh has no night colours', () => {
      const clump = parseDff(toArrayBuffer(encodeLodDff(sampleMesh(), 'lod_3_-7')));
      expect(clump.geometries[0].nightColors).toBeNull();
    });
  });
});
