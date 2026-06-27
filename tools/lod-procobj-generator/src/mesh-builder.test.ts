import type { RWClump, RWGeometry } from '@opensa/renderware/parsers/binary/types';

import { describe, expect, it } from 'vitest';

import { buildModelMesh, meshBounds } from './mesh-builder';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A clump of one atomic → one geometry, placed by a single frame (rotation 3×3 flatten + position). */
function clump(geo: RWGeometry, rotation = IDENTITY, position: [number, number, number] = [0, 0, 0]): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: '', parentIndex: -1, position, rotation }],
    geometries: [geo],
  };
}

/** A one-triangle geometry textured `texture`, with the given vertex positions. */
function geometry(positions: number[], texture: string): RWGeometry {
  return {
    materials: [{ texture: { name: texture } }],
    normals: null,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  } as unknown as RWGeometry;
}

const TRI = [0, 0, 0, 2, 0, 0, 0, 2, 0]; // a flat triangle in the XY plane

describe('buildModelMesh', () => {
  describe('positive cases', () => {
    it('buckets triangles by texture and keeps model-local positions under the identity frame', () => {
      const mesh = buildModelMesh(clump(geometry(TRI, 'bark')));

      expect(mesh.groups).toHaveLength(1);
      expect(mesh.groups[0].texture).toBe('bark');
      expect([...mesh.groups[0].indices]).toEqual([0, 1, 2]);
      expect([...mesh.positions]).toEqual(TRI);
      expect([...mesh.colors]).toEqual(new Array(12).fill(255)); // opaque white where source had no prelit
    });

    it('applies the frame translation to every vertex', () => {
      const mesh = buildModelMesh(clump(geometry(TRI, 'bark'), IDENTITY, [10, 20, 30]));

      expect([...mesh.positions]).toEqual([10, 20, 30, 12, 20, 30, 10, 22, 30]);
    });
  });
});

describe('meshBounds', () => {
  describe('positive cases', () => {
    it('returns the axis-aligned min/max of the vertices', () => {
      const bounds = meshBounds(buildModelMesh(clump(geometry([0, 0, 0, 2, 0, 5, -1, 2, 0], 'bark'))));

      expect(bounds.min).toEqual([-1, 0, 0]);
      expect(bounds.max).toEqual([2, 2, 5]);
    });
  });
});
