import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import {
  readRw,
  RW_BIN_MESH_PLG,
  RW_EXTENSION,
  RW_NIGHT_VERTEX_COLORS,
  RW_SKIN,
  RW_STRUCT,
  type RwChunk,
  writeRw,
} from '@opensa/rw-codec/chunk';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';
import { describe, expect, it } from 'vitest';

import type { SubMesh } from '../../../core/ir';

import { addNightColorsIfMissing, rebuildGeometry } from './geometry-rebuild';

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

function nightChunkOf(geometry: RwChunk): RwChunk | undefined {
  return geometry.children
    ?.find((child) => child.type === RW_EXTENSION)
    ?.children?.find((child) => child.type === RW_NIGHT_VERTEX_COLORS);
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

    it('re-emits both UV layers of a dual-UV geometry (no longer refused)', () => {
      const dual = struct(3, 1);
      dual.uvLayers = [new Float32Array([0, 0, 1, 0, 1, 1]), new Float32Array([9, 9, 9, 9, 9, 9])];
      const geometry: RwChunk = {
        children: [
          { data: encodeGeometryStruct(dual), type: RW_STRUCT, version: 0 },
          {
            children: [{ data: new Uint8Array(0), type: RW_BIN_MESH_PLG, version: 0 }],
            type: RW_EXTENSION,
            version: 0,
          },
        ],
        type: 0x0f,
        version: 0,
      };
      const m = mesh(3, [{ a: 0, b: 1, c: 2, material: 0 }]);
      m.uvs = new Float32Array([0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
      m.extraUvs = [new Float32Array([0.4, 0.4, 0.5, 0.5, 0.6, 0.6])];

      rebuildGeometry(geometry, m);

      const decoded = decodeGeometryStruct(geometry.children![0].data!);
      expect(decoded.uvLayers.length).toBe(2);
      expect([...decoded.uvLayers[0]]).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3].map((v) => Math.fround(v)));
      expect([...decoded.uvLayers[1]]).toEqual([0.4, 0.4, 0.5, 0.5, 0.6, 0.6].map((v) => Math.fround(v)));
    });
  });
});

describe('addNightColorsIfMissing', () => {
  describe('negative cases', () => {
    it('does nothing when the mesh has no synthesized night set', () => {
      const geometry = geometryChunk(4, 2);
      addNightColorsIfMissing(geometry, mesh(4, []));
      expect(nightChunkOf(geometry)).toBeUndefined();
    });

    it('leaves an existing night chunk untouched (byte-faithful)', () => {
      const existing = new Uint8Array([1, 0, 0, 0, 9, 9, 9, 9]);
      const geometry = geometryChunk(4, 2, [{ data: existing, type: RW_NIGHT_VERTEX_COLORS, version: 0 }]);
      const withNight = mesh(4, []);
      withNight.nightColors = new Uint8Array(16).fill(200);
      addNightColorsIfMissing(geometry, withNight);
      expect(nightChunkOf(geometry)!.data).toBe(existing); // same reference — not rewritten
    });
  });

  describe('positive cases', () => {
    it('appends a NIGHT_VERTEX_COLORS chunk (present=1 + RGBA) that round-trips', () => {
      const geometry = geometryChunk(2, 0);
      const withNight = mesh(2, []);
      withNight.nightColors = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
      addNightColorsIfMissing(geometry, withNight);

      const roundTripped = readRw(writeRw({ chunks: [geometry], trailing: new Uint8Array(0) })).chunks[0];
      const night = nightChunkOf(roundTripped)!.data!;
      expect(night.length).toBe(4 + 8); // present u32 + 2 × RGBA
      expect(new DataView(night.buffer, night.byteOffset).getUint32(0, true)).toBe(1);
      expect([...night.subarray(4)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    });
  });
});
