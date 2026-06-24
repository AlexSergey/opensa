import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  decodeGeometryStruct,
  encodeGeometryStruct,
  type GeometryStruct,
} from '../../../../map-optimizer/src/adapters/gta-sa/codec/geometry-struct';
import { parseDffCollision } from '../../../../src/renderware/parsers/binary/col';
import { parseDff } from '../../../../src/renderware/parsers/binary/dff';
import { toArrayBuffer } from '../../../../src/renderware/test-utils';
import {
  liftEmbeddedCollision,
  liftRootFrames,
  scaleDff,
  scaleEmbeddedCollision,
  scaleFrameList,
  scaleGeometryStruct,
} from './scale';

// Real vehicle fixture (regenerate with `npm run test:fixtures`): a full hierarchical rig + embedded COL3.
const INFERNUS = 'tests/original/dff/vehicle/infernus.dff';

/** A minimal COL3 leaf: header + 1 sphere, 1 face (→3 verts), bounds — offsets chosen so we can assert scaling. */
function colLeaf(): { data: Uint8Array; view: DataView } {
  const data = new Uint8Array(150);
  const view = new DataView(data.buffer);
  data.set([0x43, 0x4f, 0x4c, 0x33]); // "COL3"
  view.setUint32(4, 142, true); // size
  const b = 8; // body start
  view.setFloat32(b + 24, 1, true); // min.x = 1
  view.setFloat32(b + 60, 5, true); // radius = 5
  view.setUint16(b + 64, 1, true); // numSpheres
  view.setUint32(b + 68, 1, true); // numFaces
  view.setUint32(b + 76, 126, true); // offsetSpheres (body 122 + 4)
  view.setUint32(b + 88, 108, true); // offsetVertices (body 104 + 4)
  view.setUint32(b + 92, 100, true); // offsetFaces (body 96 + 4)
  // face (body 96): a=0 b=1 c=2 → 3 vertices
  view.setUint16(b + 96, 0, true);
  view.setUint16(b + 98, 1, true);
  view.setUint16(b + 100, 2, true);
  view.setInt16(b + 104, 128, true); // vertex0.x = 128/128 = 1 m
  view.setFloat32(b + 122, 3, true); // sphere0.center.x = 3
  view.setFloat32(b + 134, 2, true); // sphere0.radius = 2

  return { data, view };
}

function loadInfernus(): Uint8Array {
  return new Uint8Array(readFileSync(INFERNUS));
}

describe('scaleEmbeddedCollision', () => {
  describe('negative cases', () => {
    it('leaves non-COL data untouched', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const before = data.slice();
      scaleEmbeddedCollision(data, 2);
      expect(data).toEqual(before);
    });
  });

  describe('positive cases', () => {
    it('scales bounds, sphere primitives and int16 vertices by the factor', () => {
      const { data, view } = colLeaf();
      scaleEmbeddedCollision(data, 2);
      expect(view.getFloat32(8 + 24, true)).toBe(2); // min.x
      expect(view.getFloat32(8 + 60, true)).toBe(10); // radius
      expect(view.getFloat32(8 + 122, true)).toBe(6); // sphere centre.x
      expect(view.getFloat32(8 + 134, true)).toBe(4); // sphere radius
      expect(view.getInt16(8 + 104, true)).toBe(256); // vertex0.x int16 (128 → 256)
    });
  });
});

describe('liftEmbeddedCollision', () => {
  describe('negative cases', () => {
    it('leaves non-COL data untouched', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
      const before = data.slice();
      liftEmbeddedCollision(data, 1);
      expect(data).toEqual(before);
    });
  });

  describe('positive cases', () => {
    it('shifts only the Z components and int16 vertex Z, leaving X/Y untouched', () => {
      const { data, view } = colLeaf();
      view.setFloat32(8 + 24 + 8, -2, true); // min.z = -2
      view.setInt16(8 + 104 + 4, 128, true); // vertex0.z = 1 m
      liftEmbeddedCollision(data, 0.5);
      expect(view.getFloat32(8 + 24 + 8, true)).toBeCloseTo(-1.5, 4); // min.z + 0.5
      expect(view.getInt16(8 + 104 + 4, true)).toBe(192); // vertex0.z 128 + 0.5*128
      expect(view.getFloat32(8 + 24, true)).toBe(1); // min.x untouched
      expect(view.getInt16(8 + 104, true)).toBe(128); // vertex0.x untouched
    });
  });
});

/** A Frame List leaf with one frame: 12-byte inner Struct header, numFrames, then a 56-byte record. */
function frameListLeaf(position: [number, number, number]): Uint8Array {
  const data = new Uint8Array(16 + 56);
  const view = new DataView(data.buffer);
  view.setUint32(12, 1, true); // numFrames
  const at = 16 + 36; // record start + rotation (36)
  view.setFloat32(at, position[0], true);
  view.setFloat32(at + 4, position[1], true);
  view.setFloat32(at + 8, position[2], true);

  return data;
}

function framePosition(data: Uint8Array): [number, number, number] {
  const view = new DataView(data.buffer, data.byteOffset);
  const at = 16 + 36;

  return [view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)];
}

function struct(positions: number[], bounds: [number, number, number, number]): GeometryStruct {
  return {
    flags: 0,
    morphs: [{ bounds, normals: null, positions: new Float32Array(positions) }],
    native: 0,
    numTriangles: 0,
    numVertices: positions.length / 3,
    prelit: null,
    triangles: [],
    uvLayers: [],
  };
}

describe('scaleFrameList', () => {
  describe('negative cases', () => {
    it('leaves an empty frame list untouched', () => {
      const empty = new Uint8Array(16); // header + numFrames = 0
      const before = empty.slice();
      scaleFrameList(empty, 2);
      expect(empty).toEqual(before);
    });
  });

  describe('positive cases', () => {
    it('scales each frame translation by the factor (rotation/record bytes untouched)', () => {
      const leaf = frameListLeaf([1, 2, 3]);
      scaleFrameList(leaf, 1.5);
      expect(framePosition(leaf)).toEqual([1.5, 3, 4.5]);
    });
  });
});

describe('liftRootFrames', () => {
  describe('negative cases', () => {
    it('leaves a non-root (child) frame untouched', () => {
      const leaf = frameListLeaf([1, 2, 3]); // parentIndex defaults to 0 → a child
      liftRootFrames(leaf, 5);
      expect(framePosition(leaf)).toEqual([1, 2, 3]);
    });
  });

  describe('positive cases', () => {
    it('shifts only a root frame (parentIndex < 0) by liftZ along Z', () => {
      const leaf = frameListLeaf([1, 2, 3]);
      new DataView(leaf.buffer).setInt32(16 + 48, -1, true); // parentIndex = -1 → root
      liftRootFrames(leaf, 0.5);
      expect(framePosition(leaf)).toEqual([1, 2, 3.5]);
    });
  });
});

describe('scaleGeometryStruct', () => {
  describe('negative cases', () => {
    it('is an identity at factor 1', () => {
      const encoded = encodeGeometryStruct(struct([1, 2, 3, 4, 5, 6], [1, 1, 1, 2]));
      const out = decodeGeometryStruct(scaleGeometryStruct(encoded, 1));
      expect([...out.morphs[0].positions!]).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe('positive cases', () => {
    it('scales morph positions and the bounding sphere by the factor', () => {
      const encoded = encodeGeometryStruct(struct([1, 2, 3, 4, 5, 6], [1, 1, 1, 2]));
      const out = decodeGeometryStruct(scaleGeometryStruct(encoded, 2));
      expect([...out.morphs[0].positions!]).toEqual([2, 4, 6, 8, 10, 12]);
      expect(out.morphs[0].bounds).toEqual([2, 2, 2, 4]);
    });
  });
});

describe('scaleDff (real infernus fixture)', () => {
  describe('negative cases', () => {
    it('is a geometry identity at factor 1', () => {
      const src = loadInfernus();
      const before = parseDff(toArrayBuffer(src));
      const after = parseDff(toArrayBuffer(scaleDff(src, 1)));
      expect([...after.geometries[0].positions.slice(0, 3)]).toEqual([...before.geometries[0].positions.slice(0, 3)]);
    });
  });

  describe('positive cases', () => {
    it('scales geometry, the frame rig and the embedded collision by the factor', () => {
      const src = loadInfernus();
      const before = parseDff(toArrayBuffer(src));
      const beforeCol = parseDffCollision(toArrayBuffer(src))!;
      const scaled = scaleDff(src, 1.1);
      const after = parseDff(toArrayBuffer(scaled));
      const afterCol = parseDffCollision(toArrayBuffer(scaled))!;

      expect(after.geometries[0].positions[1]).toBeCloseTo(before.geometries[0].positions[1] * 1.1, 4);
      const dummy = before.frames.findIndex((frame) => Math.hypot(...frame.position) > 0.1);
      expect(after.frames[dummy].position[1]).toBeCloseTo(before.frames[dummy].position[1] * 1.1, 4);
      expect(afterCol.bounds.radius).toBeCloseTo(beforeCol.bounds.radius * 1.1, 3);

      expect(after.geometries.length).toBe(before.geometries.length); // topology preserved
      expect(after.frames.length).toBe(before.frames.length);
    });

    it.each([1.1, 0.95])('lifts the vehicle so the collision bottom is restored (factor %s)', (factor) => {
      const src = loadInfernus();
      const bottomBefore = parseDffCollision(toArrayBuffer(src))!.bounds.min[2];
      const afterCol = parseDffCollision(toArrayBuffer(scaleDff(src, factor)))!;
      // Scaling about the origin would move the bottom to bottom*factor; the lift restores the original.
      expect(afterCol.bounds.min[2]).toBeCloseTo(bottomBefore, 3);
    });
  });
});
