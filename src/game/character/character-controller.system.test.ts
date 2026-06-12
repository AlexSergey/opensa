import { addComponent, addEntity } from 'bitecs';
import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';

import type { KeyboardInput } from '../input/keyboard';
import type { Config } from '../interfaces/config.interface';
import type { CharacterController } from '../physics/physics-world';

import { PlayerControlled, RigidBody, Velocity } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { PhysicsWorld } from '../physics/physics-world';
import { initRapier } from '../physics/rapier';
import { CharacterControllerSystem } from './character-controller.system';

const STEP = 1 / 60;

// A default camera looks down −Z, which maps to GTA +Y → "forward" is +Y (north).
const CAMERA = new PerspectiveCamera();

interface Player {
  controller: CharacterController;
  eid: number;
  physics: PhysicsWorld;
  world: ReturnType<typeof createEcsWorld>;
}

function config(gameState: Config['gameState']): Config {
  return {
    camera: {
      followDistance: 12,
      followHeight: 1.5,
      followLerp: 3,
      followMaxPolar: 1.5,
      followMinPolar: 0.25,
      followPolar: 1.15,
      followZoom: true,
      followZoomMax: 40,
      followZoomMin: 6,
    },
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
    fog: { distance: 800 },
    fonts: { hud: { clock: 'SixCaps-Regular', zone: 'SixCaps-Regular' } },
    gameState,
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      clouds: { coverage: 0.5, opacity: 0.85 },
      effects: { drawDistance: 150, enabled: true },
      headlights: { angle: Math.PI / 7, distance: 35, glow: 0.15, intensity: 8 },
      lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
      moon: { brightness: 1, elevationDeg: 35, size: 150 },
      night: {
        coronaDrawDistance: 120,
        dynamicObjectsFill: { rim: 0.5, strength: 0.35 },
        litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 21, duskStart: 20 },
        skylight: 0.6,
        windowGlow: 1,
      },
      procobj: {
        bushes: { density: 1, drawDistance: 80, enabled: true },
        cacti: { density: 1, drawDistance: 100, enabled: true },
        flowers: { density: 1, drawDistance: 50, enabled: true },
        grass: { density: 1, drawDistance: 50, enabled: true },
        rocks: { density: 1, drawDistance: 80, enabled: true },
        trees: { density: 1, drawDistance: 150, enabled: true },
        underwater: { density: 1, drawDistance: 60, enabled: true },
      },
      shadows: { enabled: true },
      sky: { density: 0.96, exposure: 0.5, weight: 0.4 },
      ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
      stars: { enabled: true },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: false,
      vehicleReflection: { intensity: 1, preset: 'enhanced' },
      water: { darkness: 0.55, glint: 1.5, reflection: 0.6 },
      worldLight: {
        dayBrightness: 0.85,
        duskBrightness: 0.45,
        lodNightAmbScale: 1.6,
        nightPrelitBrightness: 0.7,
        shadowStrength: 0.55,
      },
    },
    hud: {
      clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 },
      zone: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 40 },
    },
    mapViewer: false,
    movement: { accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 6, runSpeed: 26, walkSpeed: 10 },
    showCollision: false,
    showLogs: false,
    staticUrl: '',
    streaming: { cellSize: 250, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1500 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
    weatherTransitionSeconds: 0,
  };
}

/** A kinematic capsule resting on a static ground, plus its ECS entity. */
async function groundedPlayer(): Promise<Player> {
  const physics = new PhysicsWorld(await initRapier());
  physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
  const controller = physics.createCharacterController();
  const { body, collider } = physics.createKinematicCapsule([0, 0, 1.4], 0.3, 0.6); // rests on the ground

  const world = createEcsWorld();
  const eid = addEntity(world);
  addComponent(world, eid, PlayerControlled);
  addComponent(world, eid, RigidBody);
  addComponent(world, eid, Velocity);
  RigidBody.handle[eid] = body;
  RigidBody.collider[eid] = collider;
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;
  Velocity.z[eid] = 0;
  Velocity.grounded[eid] = 0;
  physics.step(STEP); // build the query pipeline so the controller sees the ground

  return { controller, eid, physics, world };
}

function keys(...codes: string[]): KeyboardInput {
  const down = new Set(codes);

  return { isDown: (code) => down.has(code) };
}

function run(player: Player, cfg: Config, ...held: string[]): void {
  new CharacterControllerSystem(
    player.world,
    player.physics,
    keys(...held),
    cfg,
    player.controller,
    CAMERA,
  ).fixedUpdate(STEP);
  player.physics.step(STEP); // mirror the controller → physics step order
}

describe('CharacterControllerSystem', () => {
  describe('negative cases', () => {
    it('applies no input while paused', async () => {
      const player = await groundedPlayer();
      Velocity.x[player.eid] = 3;

      run(player, config('pause'), 'KeyW');

      expect(Velocity.x[player.eid]).toBe(3); // untouched
      player.physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('accelerates forward (+Y) toward — but not instantly to — walk speed', async () => {
      const player = await groundedPlayer();

      run(player, config('play'), 'KeyW');

      // one step: ramping up, not yet at walk speed (10), and no sideways drift
      expect(Velocity.y[player.eid]).toBeGreaterThan(0);
      expect(Velocity.y[player.eid]).toBeLessThan(10);
      expect(Velocity.x[player.eid]).toBe(0);
      player.physics.dispose();
    });

    it('reaches the target speed after sustained input', async () => {
      const player = await groundedPlayer();
      for (let i = 0; i < 120; i += 1) {
        run(player, config('play'), 'KeyW');
      }
      expect(Velocity.y[player.eid]).toBeCloseTo(10, 1); // settled at walk speed
      player.physics.dispose();
    });

    it('decelerates toward rest (inertia) when keys are released', async () => {
      const player = await groundedPlayer();
      Velocity.x[player.eid] = 5;
      Velocity.y[player.eid] = 5;

      run(player, config('play')); // no keys held

      // slowing toward 0 but not there in a single step
      expect(Velocity.x[player.eid]).toBeLessThan(5);
      expect(Velocity.x[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });

    it('jumps (+Z velocity) on the jump key when grounded', async () => {
      const player = await groundedPlayer();
      run(player, config('play')); // settle → grounded
      expect(Velocity.grounded[player.eid]).toBe(1);

      run(player, config('play'), 'Space');

      expect(Velocity.z[player.eid]).toBeGreaterThan(0);
      player.physics.dispose();
    });
  });
});
