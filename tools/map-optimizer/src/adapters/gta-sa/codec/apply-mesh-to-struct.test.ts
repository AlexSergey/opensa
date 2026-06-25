import { decodeGeometryStruct, encodeGeometryStruct, type GeometryStruct } from '@opensa/rw-codec/geometry-struct';
import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../../../core/ir';

import { applyMeshToStruct } from './geometry-rebuild';

const PRELIT_FLAG = 0x0008;
const NORMALS_FLAG = 0x0010;

function mesh(overrides: Partial<SubMesh>): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, material: 0 }],
    uvs: null,
    ...overrides,
  };
}

/** A minimal 3-vertex, 1-triangle Struct with prelit + one UV layer + positions, optionally normals. */
function sampleStruct(withNormals: boolean): GeometryStruct {
  return {
    flags: PRELIT_FLAG | (withNormals ? NORMALS_FLAG : 0),
    morphs: [
      {
        bounds: [0, 0, 0, 1],
        normals: withNormals ? new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]) : null,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      },
    ],
    native: 0,
    numTriangles: 1,
    numVertices: 3,
    prelit: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    triangles: [{ a: 0, b: 1, c: 2, material: 0 }],
    uvLayers: [new Float32Array([0, 0, 1, 0, 1, 1])],
  };
}

describe('applyMeshToStruct', () => {
  describe('negative cases', () => {
    it('throws when the mesh vertex count differs from the Struct', () => {
      const bytes = encodeGeometryStruct(sampleStruct(false));
      const tooFew = mesh({ positions: new Float32Array([0, 0, 0]) });

      expect(() => applyMeshToStruct(bytes, tooFew)).toThrow(/topology change unsupported/);
    });
  });

  describe('positive cases', () => {
    it('adds a normals block to a Struct that had none', () => {
      const noNormals = encodeGeometryStruct(sampleStruct(false));
      const normals = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

      const decoded = decodeGeometryStruct(applyMeshToStruct(noNormals, mesh({ normals })));

      expect(decoded.flags & NORMALS_FLAG).toBeTruthy();
      expect(decoded.morphs[0].normals).toEqual(normals);
      expect(decoded.numVertices).toBe(3);
      expect(decoded.morphs[0].positions).toEqual(sampleStruct(false).morphs[0].positions);
    });
  });
});
