import { addComponent, addEntity } from 'bitecs';
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';

import type { KeyboardInput } from '../input/keyboard';
import type { Config } from '../interfaces/config.interface';

import { PlayerControlled, RigidBody } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { PhysicsWorld } from '../physics/physics-world';
import { initRapier } from '../physics/rapier';
import { CharacterControllerSystem } from './character-controller.system';

const HALF = 0.5;

// A default camera looks down −Z, which maps to GTA +Y → "forward" is +Y (north).
const CAMERA = new PerspectiveCamera();

function config(gameState: Config['gameState']): Config {
  return {
    camera: { followDistance: 12, followMaxPolar: 1.5, followMinPolar: 0.25, followZoom: true },
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
    debugMode: false,
    gameState,
    movement: { jumpSpeed: 6, runSpeed: 26, walkSpeed: 10 },
    showCollision: false,
    staticUrl: '',
    streaming: { cellSize: 250, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1500 },
  };
}

/** A character body resting on the ground, plus its ECS entity + handle. */
async function groundedPlayer(): Promise<{
  handle: number;
  physics: PhysicsWorld;
  world: ReturnType<typeof createEcsWorld>;
}> {
  const physics = new PhysicsWorld(await initRapier());
  physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
  const handle = physics.createCharacterBody([0, 0, 1], [HALF, HALF, HALF]); // rests with centre at 1.0
  for (let i = 0; i < 30; i += 1) {
    physics.step(1 / 60);
  }
  const world = createEcsWorld();
  const eid = addEntity(world);
  addComponent(world, eid, PlayerControlled);
  addComponent(world, eid, RigidBody);
  RigidBody.handle[eid] = handle;

  return { handle, physics, world };
}

function keys(...codes: string[]): KeyboardInput {
  const down = new Set(codes);

  return { isDown: (code) => down.has(code) };
}

describe('CharacterControllerSystem', () => {
  describe('negative cases', () => {
    it('applies no input while paused', async () => {
      const { handle, physics, world } = await groundedPlayer();
      physics.setLinvel(handle, [3, 0, 0]);

      new CharacterControllerSystem(world, physics, keys('KeyW'), config('pause'), HALF, CAMERA).fixedUpdate();

      expect(physics.getLinvel(handle)[0]).toBeCloseTo(3); // untouched
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('moves forward (+Y) on the forward key when grounded', async () => {
      const { handle, physics, world } = await groundedPlayer();

      new CharacterControllerSystem(world, physics, keys('KeyW'), config('play'), HALF, CAMERA).fixedUpdate();

      const velocity = physics.getLinvel(handle);
      expect(velocity[1]).toBeGreaterThan(0);
      expect(velocity[0]).toBe(0);
      physics.dispose();
    });

    it('stops planar motion when grounded with no keys held', async () => {
      const { handle, physics, world } = await groundedPlayer();
      physics.setLinvel(handle, [5, 5, 0]);

      new CharacterControllerSystem(world, physics, keys(), config('play'), HALF, CAMERA).fixedUpdate();

      const velocity = physics.getLinvel(handle);
      expect(velocity[0]).toBe(0);
      expect(velocity[1]).toBe(0);
      physics.dispose();
    });

    it('jumps (+Z velocity) on the jump key when grounded', async () => {
      const { handle, physics, world } = await groundedPlayer();

      new CharacterControllerSystem(world, physics, keys('Space'), config('play'), HALF, CAMERA).fixedUpdate();

      expect(physics.getLinvel(handle)[2]).toBeGreaterThan(0);
      physics.dispose();
    });
  });
});
