import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import type { ColliderShape, ModelColliders } from '../interfaces/collider.interface';

import { PhysicsWorld } from './physics-world';
import { initRapier } from './rapier';

const STEP = 1 / 60;

async function makeWorld(): Promise<PhysicsWorld> {
  return new PhysicsWorld(await initRapier());
}

function model(colliderShape: ColliderShape, transforms: Matrix4[]): ModelColliders {
  return { name: 'm', shape: colliderShape, transforms };
}

function shape(partial: Partial<ColliderShape> = {}): ColliderShape {
  return { boxes: [], indices: new Uint32Array(), spheres: [], vertices: new Float32Array(), ...partial };
}

describe('PhysicsWorld', () => {
  describe('positive cases', () => {
    it('drops a dynamic box under gravity until it rests on a static ground', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);

      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      // rests with its centre at ground-top (0.5) + half-height (0.5) = 1.0
      expect(physics.readBody(box).position[2]).toBeCloseTo(1, 1);
      physics.dispose();
    });

    it('reports the body falling before it lands', async () => {
      const physics = await makeWorld();
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]); // no ground

      physics.step(STEP);
      const { position } = physics.readBody(box);

      expect(position[2]).toBeLessThan(5);
      expect(position[0]).toBe(0);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createStaticColliders', () => {
  describe('negative cases', () => {
    it('creates nothing for no models', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([])).toBe(0);
      physics.dispose();
    });

    it('skips a model with empty shapes', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([model(shape(), [new Matrix4()])])).toBe(0);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('creates a collider per shape, per placement', async () => {
      const physics = await makeWorld();
      const colliderShape = shape({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }],
        indices: new Uint32Array([0, 1, 2]),
        spheres: [{ center: [0, 0, 0], radius: 1 }],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });
      const transforms = [new Matrix4(), new Matrix4().makeTranslation(10, 0, 0)];

      // (trimesh + box + sphere) * 2 placements
      expect(physics.createStaticColliders([model(colliderShape, transforms)])).toBe(6);
      physics.dispose();
    });

    it('counts only the box when there is no mesh', async () => {
      const physics = await makeWorld();
      const colliderShape = shape({ boxes: [{ max: [1, 2, 3], min: [0, 0, 0] }] });

      expect(physics.createStaticColliders([model(colliderShape, [new Matrix4()])])).toBe(1);
      physics.dispose();
    });
  });
});
