import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import type { ColModel } from '../../renderware';

import { toModelColliders } from './gta-sa-world.adapter';

function colModel(partial: Partial<ColModel>): ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 },
    boxes: [],
    faces: [],
    modelId: 0,
    name: 'col',
    spheres: [],
    version: 2,
    vertices: new Float32Array(),
    ...partial,
  };
}

const SURFACE = { brightness: 0, flag: 0, light: 0, material: 0 };

describe('toModelColliders', () => {
  describe('negative cases', () => {
    it('produces empty shape arrays for a model with no geometry', () => {
      const result = toModelColliders({ col: colModel({}), name: 'empty', transforms: [] });

      expect(result.name).toBe('empty');
      expect(result.shape.indices).toHaveLength(0);
      expect(result.shape.boxes).toEqual([]);
      expect(result.shape.spheres).toEqual([]);
      expect(result.transforms).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('flattens faces into a triangle index array and passes vertices through', () => {
      const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
      const col = colModel({
        faces: [
          { a: 0, b: 1, c: 2, light: 0, material: 0 },
          { a: 2, b: 3, c: 0, light: 0, material: 0 },
        ],
        vertices,
      });

      const result = toModelColliders({ col, name: 'wall', transforms: [new Matrix4()] });
      expect(Array.from(result.shape.indices)).toEqual([0, 1, 2, 2, 3, 0]);
      expect(result.shape.vertices).toBe(vertices); // passthrough, not copied
      expect(result.transforms).toHaveLength(1);
    });

    it('maps box and sphere primitives (dropping surface data)', () => {
      const col = colModel({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1], surface: SURFACE }],
        spheres: [{ center: [0, 0, 2], radius: 0.5, surface: SURFACE }],
      });

      const result = toModelColliders({ col, name: 'prop', transforms: [] });
      expect(result.shape.boxes).toEqual([{ max: [1, 1, 1], min: [-1, -1, -1] }]);
      expect(result.shape.spheres).toEqual([{ center: [0, 0, 2], radius: 0.5 }]);
    });
  });
});
