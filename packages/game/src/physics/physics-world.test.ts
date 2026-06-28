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

describe('PhysicsWorld.groundBelow', () => {
  describe('negative cases', () => {
    it('returns null when nothing is below within maxDrop', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
      physics.step(STEP); // build the query pipeline so the ray sees the ground

      expect(physics.groundBelow([0, 0, 5], 2)).toBeNull(); // ground is 4.5 below, beyond maxDrop 2
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('finds the Z of the ground directly below the position', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      physics.step(STEP);

      expect(physics.groundBelow([0, 0, 10], 100)).toBeCloseTo(0.5, 3);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createDynamicVehicle', () => {
  const HALF: [number, number, number] = [1.2, 2.5, 0.7];

  describe('negative cases', () => {
    it('does not crash when the model has no COL (null shape) — falls back to the halfExtents box', async () => {
      const physics = await makeWorld();
      expect(() => physics.createDynamicVehicle([0, 0, 5], 0, null, 1500, [], HALF)).not.toThrow();
      physics.dispose();
    });

    it('does not crash for a shape with no primitives and no vertices', async () => {
      const physics = await makeWorld();
      expect(() => physics.createDynamicVehicle([0, 0, 5], 0, shape(), 1500, [], HALF)).not.toThrow();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('builds a convex hull from a vertices-only shape and rests it on the ground', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [20, 20, 0.5]); // top surface at z = 0.5
      // eight corners of a 1m cube → a valid convex hull (half-height 0.5)
      const cube = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
      ]);
      const { body } = physics.createDynamicVehicle([0, 0, 5], 0, shape({ vertices: cube }), 1500, [], HALF);

      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readBody(body).position[2]).toBeCloseTo(1, 0); // ground-top 0.5 + half-height 0.5
      physics.dispose();
    });
  });
});

describe('PhysicsWorld kinematic character controller', () => {
  describe('positive cases', () => {
    it('lands a kinematic capsule on a static ground and reports grounded', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const controller = physics.createCharacterController();
      const { body, collider } = physics.createKinematicCapsule([0, 0, 3], 0.3, 0.6);

      let grounded = false;
      for (let i = 0; i < 240; i += 1) {
        grounded = physics.moveCharacter(controller, body, collider, [0, 0, -0.05]).grounded;
        physics.step(STEP);
      }

      expect(grounded).toBe(true);
      // centre rests at ground-top (0.5) + capsule half-height (0.6 + radius 0.3) = 1.4
      expect(physics.readBody(body).position[2]).toBeCloseTo(1.4, 1);
      physics.dispose();
    });

    it('slides along a wall instead of penetrating it', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // ground
      physics.createStaticBox([2, 0, 1.5], [0.5, 5, 2]); // wall, front face at x = 1.5
      const controller = physics.createCharacterController();
      const { body, collider } = physics.createKinematicCapsule([0, 0, 1.4], 0.3, 0.6);

      for (let i = 0; i < 120; i += 1) {
        physics.moveCharacter(controller, body, collider, [0.1, 0, -0.02]); // push into the wall
        physics.step(STEP);
      }

      // stopped in front of the wall (front 1.5 − radius 0.3 − offset), never penetrating it
      expect(physics.readBody(body).position[0]).toBeLessThan(1.25);
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
