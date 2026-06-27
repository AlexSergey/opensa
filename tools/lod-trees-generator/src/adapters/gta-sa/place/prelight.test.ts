import type { RwChunk } from '@opensa/rw-codec/chunk';
import type { GeometryStruct } from '@opensa/rw-codec/geometry-struct';

import { readRw, RW_CLUMP, RW_GEOMETRY, RW_GEOMETRY_LIST, RW_STRUCT, writeRw } from '@opensa/rw-codec/chunk';
import { collectGeometryStructs } from '@opensa/rw-codec/dff';
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';
import { describe, expect, it } from 'vitest';

import { applyStockPrelight } from './prelight';

const VERSION = 0x1803ffff;
const PRELIT_FLAG = 0x0008;

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
  const struct = collectGeometryStructs(readRw(bytes).chunks)[index];

  return decodeGeometryStruct(struct.data!).prelit;
}

describe('applyStockPrelight', () => {
  describe('negative cases', () => {
    it('returns the custom unchanged when the stock has no prelit', () => {
      const custom = dff(geometryStruct(3, null));
      const result = applyStockPrelight(custom, dff(geometryStruct(3, null)));

      expect(result).toBe(custom);
      expect(prelitOf(result)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('fills the custom uniformly with the stock average when vertex counts differ', () => {
      const stockPrelit = new Uint8Array([100, 100, 100, 255, 200, 200, 200, 255]); // mean → 150,150,150,255
      const result = applyStockPrelight(dff(geometryStruct(3, null)), dff(geometryStruct(2, stockPrelit)));
      const prelit = prelitOf(result)!;

      expect(prelit).toHaveLength(3 * 4);
      expect([...prelit]).toEqual([150, 150, 150, 255, 150, 150, 150, 255, 150, 150, 150, 255]);
    });

    it('sets the PRELIT flag on a custom geometry that lacked one', () => {
      const result = applyStockPrelight(
        dff(geometryStruct(2, null)),
        dff(geometryStruct(2, new Uint8Array(8).fill(80))),
      );
      const struct = decodeGeometryStruct(collectGeometryStructs(readRw(result).chunks)[0].data!);

      expect(struct.flags & PRELIT_FLAG).toBe(PRELIT_FLAG);
    });

    it('copies the stock prelit verbatim when the vertex counts match (full fidelity)', () => {
      const stockPrelit = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
      const result = applyStockPrelight(dff(geometryStruct(3, null)), dff(geometryStruct(3, stockPrelit)));

      expect([...prelitOf(result)!]).toEqual([...stockPrelit]);
    });
  });
});
