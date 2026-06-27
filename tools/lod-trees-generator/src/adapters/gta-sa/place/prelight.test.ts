import type { RwChunk } from '@opensa/rw-codec/chunk';
import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import { readRw, RW_CLUMP, RW_GEOMETRY, RW_GEOMETRY_LIST, RW_STRUCT, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometryStructs } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';
import { describe, expect, it } from 'vitest';

import { applyStockPrelight, stockPrelightColor, trunkOnlyPrelit } from './prelight';

const VERSION = 0x1803ffff;
const PRELIT_FLAG = 0x0008;
const noFoliage = (): boolean => false;

/** Wrap geometry Structs into a Clump → GeometryList → Geometry DFF that `collectGeometries` walks. */
function dff(...structs: GeometryStruct[]): Uint8Array {
  const geometries: RwChunk[] = structs.map((struct) => ({
    children: [{ data: encodeGeometryStruct(struct), type: RW_STRUCT, version: VERSION }],
    type: RW_GEOMETRY,
    version: VERSION,
  }));

  return writeRw({
    chunks: [
      {
        children: [{ children: geometries, type: RW_GEOMETRY_LIST, version: VERSION }],
        type: RW_CLUMP,
        version: VERSION,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

/** A minimal geometry Struct: `numVertices`, optional prelit, no triangles/UVs (enough for the prelight path). */
function geometryStruct(numVertices: number, prelit: null | Uint8Array): GeometryStruct {
  return {
    flags: prelit ? PRELIT_FLAG : 0,
    morphs: [{ bounds: [0, 0, 0, 0], normals: null, positions: null }],
    native: 0,
    numTriangles: 0,
    numVertices,
    prelit,
    triangles: [],
    uvLayers: [],
  };
}

function prelitOf(bytes: Uint8Array, index = 0): null | Uint8Array {
  return decodeGeometryStruct(collectGeometryStructs(readRw(bytes).chunks)[index].data!).prelit;
}

describe('stockPrelightColor', () => {
  describe('negative cases', () => {
    it('returns null when the stock carries no prelit', () => {
      expect(stockPrelightColor(dff(geometryStruct(3, null)))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('averages the stock prelit vertices', () => {
      const prelit = new Uint8Array([100, 100, 100, 255, 200, 200, 200, 255]); // mean → 150,150,150,255
      expect(stockPrelightColor(dff(geometryStruct(2, prelit)))).toEqual([150, 150, 150, 255]);
    });
  });
});

describe('trunkOnlyPrelit', () => {
  describe('positive cases', () => {
    it('fills every vertex with the trunk average when no foliage is masked', () => {
      expect([...trunkOnlyPrelit(2, null, [150, 150, 150, 255], [])]).toEqual([150, 150, 150, 255, 150, 150, 150, 255]);
    });

    it('keeps a foliage vertex’s existing colour, applies the average to the trunk vertex', () => {
      const existing = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      const out = trunkOnlyPrelit(2, existing, [1, 2, 3, 4], [true, false]); // v0 foliage, v1 trunk

      expect([...out]).toEqual([10, 20, 30, 40, 1, 2, 3, 4]);
    });

    it('whites a foliage vertex when the custom had no prelit', () => {
      expect([...trunkOnlyPrelit(1, null, [9, 9, 9, 9], [true])]).toEqual([255, 255, 255, 255]);
    });
  });
});

describe('applyStockPrelight', () => {
  describe('negative cases', () => {
    it('returns the custom unchanged when the stock has no prelit', () => {
      const custom = dff(geometryStruct(3, null));
      const result = applyStockPrelight(custom, dff(geometryStruct(3, null)), noFoliage);

      expect(result).toBe(custom);
      expect(prelitOf(result)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('fills the custom trunk with the stock average and sets the PRELIT flag', () => {
      const stockPrelit = new Uint8Array([100, 100, 100, 255, 200, 200, 200, 255]); // mean → 150,150,150,255
      const result = applyStockPrelight(dff(geometryStruct(3, null)), dff(geometryStruct(2, stockPrelit)), noFoliage);
      const struct = decodeGeometryStruct(collectGeometryStructs(readRw(result).chunks)[0].data!);

      expect(struct.flags & PRELIT_FLAG).toBe(PRELIT_FLAG);
      expect([...struct.prelit!]).toEqual([150, 150, 150, 255, 150, 150, 150, 255, 150, 150, 150, 255]);
    });
  });
});
