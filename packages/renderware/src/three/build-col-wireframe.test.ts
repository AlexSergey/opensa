import { existsSync, readFileSync } from 'node:fs';
import { LineSegments, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import type { RegionColliders } from '../collision';
import type { ColModel } from '../parsers/binary/col-types';

import { parseColLibrary } from '../parsers/binary/col';
import { toArrayBuffer } from '../test-utils';
import { buildCollisionWireframe } from './build-col-wireframe';

function colModel(partial: Partial<ColModel>): ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 },
    boxes: [],
    faces: [],
    modelId: 0,
    name: 'col',
    spheres: [],
    version: 3,
    vertices: new Float32Array(),
    ...partial,
  };
}

function positionsOf(colliders: RegionColliders[]): Float32Array {
  const overlay = buildCollisionWireframe(colliders);
  expect(overlay).toBeInstanceOf(LineSegments);
  const attribute = (overlay as LineSegments).geometry.getAttribute('position');

  return attribute.array as Float32Array;
}

describe('buildCollisionWireframe', () => {
  describe('negative cases', () => {
    it('produces an empty geometry for no colliders', () => {
      expect(positionsOf([])).toHaveLength(0);
    });

    it('produces an empty geometry for a collider with no shapes', () => {
      expect(positionsOf([{ col: colModel({}), name: 'col', transforms: [new Matrix4()] }])).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('emits the three edges of a triangle face under an identity transform', () => {
      const col = colModel({
        faces: [{ a: 0, b: 1, c: 2, light: 0, material: 0 }],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });

      const positions = positionsOf([{ col, name: 'col', transforms: [new Matrix4()] }]);
      // 3 edges * 2 endpoints * 3 components
      expect(Array.from(positions)).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]);
    });

    it('applies the placement transform to the line endpoints', () => {
      const col = colModel({
        faces: [{ a: 0, b: 1, c: 2, light: 0, material: 0 }],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });

      const positions = positionsOf([{ col, name: 'col', transforms: [new Matrix4().makeTranslation(10, 0, 0)] }]);
      expect(positions[0]).toBe(10); // first vertex x shifted by +10
      expect(positions[3]).toBe(11); // second endpoint (1,0,0) -> (11,0,0)
    });

    it('draws 12 edges for a box', () => {
      const col = colModel({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1], surface: { brightness: 0, flag: 0, light: 0, material: 0 } }],
      });

      // 12 edges * 2 endpoints * 3 components
      expect(positionsOf([{ col, name: 'col', transforms: [new Matrix4()] }])).toHaveLength(72);
    });

    it('draws three great-circle rings for a sphere, all on its surface', () => {
      const col = colModel({
        spheres: [{ center: [1, 2, 3], radius: 5, surface: { brightness: 0, flag: 0, light: 0, material: 0 } }],
      });

      const positions = positionsOf([{ col, name: 'col', transforms: [new Matrix4()] }]);
      // 3 axes * 12 segments * 2 endpoints * 3 components
      expect(positions).toHaveLength(3 * 12 * 2 * 3);
      // Every ring point sits on the sphere surface (one coordinate is the centre's, the plane radius = 5).
      for (let i = 0; i < positions.length; i += 3) {
        const dx = positions[i] - 1;
        const dy = positions[i + 1] - 2;
        const dz = positions[i + 2] - 3;
        expect(Math.hypot(dx, dy, dz)).toBeCloseTo(5, 5);
      }
    });

    it('repeats a model once per placement transform', () => {
      const col = colModel({
        faces: [{ a: 0, b: 1, c: 2, light: 0, material: 0 }],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });
      const transforms = [new Matrix4(), new Matrix4().makeTranslation(5, 0, 0)];

      expect(positionsOf([{ col, name: 'col', transforms }])).toHaveLength(36); // 18 per placement * 2
    });
  });
});

// Real COL libraries: a 308-face trimesh (countn2_17) and a box-based model (barriers).
const TRIMESH_COL = 'tests/original/col/countn2_17.col';
const BOX_COL = 'tests/original/col/barriers.col';

describe.skipIf(!existsSync(TRIMESH_COL) || !existsSync(BOX_COL))('buildCollisionWireframe (real COL)', () => {
  function firstModel(path: string): ColModel {
    return parseColLibrary(toArrayBuffer(new Uint8Array(readFileSync(path))))[0];
  }

  describe('positive cases', () => {
    it('wires every face of a real trimesh (3 edges * 2 endpoints * 3 components each)', () => {
      const col = firstModel(TRIMESH_COL); // s_bit_13: 308 faces, no boxes
      expect(col.faces.length).toBe(308);
      const positions = positionsOf([{ col, name: col.name, transforms: [new Matrix4()] }]);
      expect(positions).toHaveLength(col.faces.length * 18);
    });

    it('wires the 12 edges of each box in a real box collider', () => {
      const col = firstModel(BOX_COL); // bar_gatebar01: box-based, no faces
      expect(col.boxes.length).toBeGreaterThan(0);
      const positions = positionsOf([{ col, name: col.name, transforms: [new Matrix4()] }]);
      expect(positions).toHaveLength(col.boxes.length * 72);
    });
  });
});
