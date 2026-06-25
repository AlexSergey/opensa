import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { toArrayBuffer } from '@opensa/renderware/test-utils';
import { describe, expect, it } from 'vitest';

import type { MergedMesh } from '../../core/types';

import { encodeCellDff } from './dff';

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

describe('encodeCellDff', () => {
  describe('negative cases', () => {
    it('throws when the mesh exceeds the u16 vertex limit', () => {
      const big: MergedMesh = {
        colors: new Uint8Array((0xffff + 1) * 4),
        groups: [],
        normals: new Float32Array((0xffff + 1) * 3),
        positions: new Float32Array((0xffff + 1) * 3),
        uvs: new Float32Array((0xffff + 1) * 2),
      };
      expect(() => encodeCellDff(big, 'lod_big')).toThrow(/65535/);
    });
  });

  describe('positive cases', () => {
    it('round-trips through the engine parser with geometry, materials and prelit intact', () => {
      const clump = parseDff(toArrayBuffer(encodeCellDff(sampleMesh(), 'lod_3_-7')));
      expect(clump.atomics).toHaveLength(1);
      expect(clump.frames).toHaveLength(1);
      expect(clump.frames[0].name).toBe('lod_3_-7');

      const geometry = clump.geometries[0];
      expect(geometry.positions).toHaveLength(12);
      expect(geometry.triangles).toHaveLength(2);
      expect(geometry.prelitColors).not.toBeNull();
      expect(geometry.uvLayers[0]).toHaveLength(8);
      expect(geometry.materials.map((m) => m.texture?.name)).toEqual(['road', 'grass']);
    });

    it('assigns each triangle to its texture group via the BinMesh split', () => {
      const clump = parseDff(toArrayBuffer(encodeCellDff(sampleMesh(), 'lod_cell')));
      const materials = clump.geometries[0].triangles.map((t) => t.materialIndex).sort();
      expect(materials).toEqual([0, 1]); // one triangle per group
    });
  });
});
