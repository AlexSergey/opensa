import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../../../core/ir';
import type { GeometryStruct } from './geometry-struct';

import { RW_BIN_MESH_PLG, RW_EXTENSION, RW_SKIN, RW_STRUCT, type RwChunk } from './chunk';
import { rebuildGeometry } from './geometry-rebuild';
import { decodeGeometryStruct, encodeGeometryStruct } from './geometry-struct';

function geometryChunk(numVertices: number, numTriangles: number, extras: RwChunk[] = []): RwChunk {
  return {
    children: [
      { data: encodeGeometryStruct(struct(numVertices, numTriangles)), type: RW_STRUCT, version: 0 },
      {
        children: [{ data: new Uint8Array(0), type: RW_BIN_MESH_PLG, version: 0 }, ...extras],
        type: RW_EXTENSION,
        version: 0,
      },
    ],
    type: 0x0f,
    version: 0,
  };
}

function mesh(numVertices: number, triangles: SubMesh['triangles']): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: new Float32Array(numVertices * 3),
    positions: new Float32Array(numVertices * 3),
    prelitColors: null,
    triangles,
    uvs: null,
  };
}

function struct(numVertices: number, numTriangles: number): GeometryStruct {
  return {
    flags: 0x0010, // NORMALS
    morphs: [
      {
        bounds: [0, 0, 0, 1],
        normals: new Float32Array(numVertices * 3),
        positions: new Float32Array(numVertices * 3),
      },
    ],
    native: 0,
    numTriangles,
    numVertices,
    prelit: null,
    triangles: Array.from({ length: numTriangles }, () => ({ a: 0, b: 1, c: 2, material: 0 })),
    uvLayers: [],
  };
}

describe('rebuildGeometry', () => {
  describe('negative cases', () => {
    it('throws on a skinned geometry (the IR cannot remap bone weights)', () => {
      const geometry = geometryChunk(4, 2, [{ data: new Uint8Array(4), type: RW_SKIN, version: 0 }]);
      expect(() => rebuildGeometry(geometry, mesh(4, [{ a: 0, b: 1, c: 2, material: 0 }]))).toThrow(/skinned/);
    });
  });

  describe('positive cases', () => {
    it('rebuilds the Struct to the new triangle count and regenerates a trilist BinMeshPLG', () => {
      const geometry = geometryChunk(4, 2);
      // Drop to one triangle across two materials worth of indices (single material here).
      rebuildGeometry(geometry, mesh(4, [{ a: 0, b: 1, c: 2, material: 0 }]));

      const structData = geometry.children![0].data!;
      const decoded = decodeGeometryStruct(structData);
      expect(decoded.numTriangles).toBe(1);
      expect(decoded.numVertices).toBe(4);

      const bin = geometry.children![1].children![0].data!;
      const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
      expect(view.getUint32(0, true)).toBe(0); // trilist flag
      expect(view.getUint32(4, true)).toBe(1); // one material split
      expect(view.getUint32(8, true)).toBe(3); // total indices
      expect(view.getUint32(12, true)).toBe(3); // split: numIndices
      expect(view.getUint32(16, true)).toBe(0); // split: materialIndex
      expect([view.getUint32(20, true), view.getUint32(24, true), view.getUint32(28, true)]).toEqual([0, 1, 2]);
    });
  });
});
