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

describe('PhysicsWorld.createStaticColliders / removeBodies', () => {
  describe('negative cases', () => {
    it('creates no bodies for no models', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([])).toHaveLength(0);
      physics.dispose();
    });

    it('creates no body for a placement with only degenerate shapes', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([model(shape(), [new Matrix4()])])).toHaveLength(0);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('returns one body handle per placement', async () => {
      const physics = await makeWorld();
      const colliderShape = shape({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }],
        indices: new Uint32Array([0, 1, 2]),
        spheres: [{ center: [0, 0, 0], radius: 1 }],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });
      const transforms = [new Matrix4(), new Matrix4().makeTranslation(10, 0, 0)];

      // one body per placement (each carrying trimesh + box + sphere)
      expect(physics.createStaticColliders([model(colliderShape, transforms)])).toHaveLength(2);
      physics.dispose();
    });

    it('removeBodies frees the ground so a resting box falls again', async () => {
      const physics = await makeWorld();
      const ground = model(shape({ boxes: [{ max: [10, 10, 0.5], min: [-10, -10, -0.5] }] }), [new Matrix4()]);
      const handles = physics.createStaticColliders([ground]); // top surface at z = 0.5
      const box = physics.createBox([0, 0, 2], [0.5, 0.5, 0.5]);

      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.readBody(box).position[2]).toBeCloseTo(1, 1); // rests on the ground

      physics.removeBodies(handles);
      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.readBody(box).position[2]).toBeLessThan(0); // ground gone → falls through
      physics.dispose();
    });
  });
});
