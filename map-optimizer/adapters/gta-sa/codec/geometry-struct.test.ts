import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../../../core/ir';
import type { GeometryStruct } from './geometry-struct';

import { readRw } from './chunk';
import { collectGeometryStructs } from './dff';
import { applyMeshToStruct, decodeGeometryStruct, encodeGeometryStruct } from './geometry-struct';

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

/** A minimal 3-vertex, 1-triangle, 1-morph Struct with prelit + one UV layer + positions (no normals). */
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

describe('Geometry Struct codec', () => {
  describe('positive cases', () => {
    it('round-trips encode → decode (synthetic)', () => {
      const struct = sampleStruct(true);
      const decoded = decodeGeometryStruct(encodeGeometryStruct(struct));
      expect(decoded).toEqual(struct);
    });

    it('round-trips real fixture Structs byte-for-byte', () => {
      const bytes = new Uint8Array(readFileSync('tests/custom/character/gostown-bmypol1.dff'));
      const structs = collectGeometryStructs(readRw(bytes).chunks);
      expect(structs.length).toBeGreaterThan(0);
      for (const struct of structs) {
        const data = struct.data!;
        expect(Buffer.from(encodeGeometryStruct(decodeGeometryStruct(data))).equals(Buffer.from(data))).toBe(true);
      }
    });

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

  describe('negative cases', () => {
    it('throws when the mesh vertex count differs from the Struct', () => {
      const bytes = encodeGeometryStruct(sampleStruct(false));
      const tooFew = mesh({ positions: new Float32Array([0, 0, 0]) });

      expect(() => applyMeshToStruct(bytes, tooFew)).toThrow(/topology change unsupported/);
    });
  });
});
