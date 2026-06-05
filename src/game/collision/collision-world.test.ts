import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import type { ModelColliders } from '../interfaces/collider.interface';

import { CollisionWorld } from './collision-world';

function modelColliders(name: string, placements: number): ModelColliders {
  return {
    name,
    shape: { boxes: [], indices: new Uint32Array(), spheres: [], vertices: new Float32Array() },
    transforms: Array.from({ length: placements }, () => new Matrix4()),
  };
}

describe('CollisionWorld', () => {
  describe('negative cases', () => {
    it('starts empty', () => {
      const world = new CollisionWorld();
      expect(world.models).toEqual([]);
      expect(world.placementCount).toBe(0);
    });

    it('clears back to empty', () => {
      const world = new CollisionWorld();
      world.set([modelColliders('wall', 2)]);
      world.clear();

      expect(world.models).toEqual([]);
      expect(world.placementCount).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('holds the models it is given', () => {
      const world = new CollisionWorld();
      const colliders = [modelColliders('wall', 1), modelColliders('gate', 3)];
      world.set(colliders);

      expect(world.models.map((m) => m.name)).toEqual(['wall', 'gate']);
    });

    it('sums placements across all models', () => {
      const world = new CollisionWorld();
      world.set([modelColliders('wall', 2), modelColliders('gate', 3)]);

      expect(world.placementCount).toBe(5);
    });

    it('replaces the previous models on set', () => {
      const world = new CollisionWorld();
      world.set([modelColliders('wall', 2)]);
      world.set([modelColliders('gate', 1)]);

      expect(world.models.map((m) => m.name)).toEqual(['gate']);
      expect(world.placementCount).toBe(1);
    });
  });
});
