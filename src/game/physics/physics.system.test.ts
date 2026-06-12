import { addComponent, addEntity } from 'bitecs';
import { describe, expect, it } from 'vitest';

import type { Config } from '../interfaces/config.interface';

import { RigidBody, Transform } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { PhysicsWorld } from './physics-world';
import { PhysicsSystem } from './physics.system';
import { initRapier } from './rapier';

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

async function fallingEntity(): Promise<{
  eid: number;
  physics: PhysicsWorld;
  world: ReturnType<typeof createEcsWorld>;
}> {
  const physics = new PhysicsWorld(await initRapier());
  const world = createEcsWorld();
  const eid = addEntity(world);
  addComponent(world, eid, Transform);
  addComponent(world, eid, RigidBody);
  RigidBody.handle[eid] = physics.createBox([0, 0, 10], [0.5, 0.5, 0.5]); // falling, no ground
  Transform.z[eid] = 10;

  return { eid, physics, world };
}

describe('PhysicsSystem', () => {
  describe('negative cases', () => {
    it('does not step or write transforms while paused', async () => {
      const { eid, physics, world } = await fallingEntity();

      new PhysicsSystem(world, physics, config('pause')).fixedUpdate(1 / 60);

      expect(Transform.z[eid]).toBe(10); // unchanged
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('writes each rigid body transform onto its entity Transform while playing', async () => {
      const { eid, physics, world } = await fallingEntity();

      new PhysicsSystem(world, physics, config('play')).fixedUpdate(1 / 60);

      expect(Transform.x[eid]).toBe(0);
      expect(Transform.y[eid]).toBe(0);
      expect(Transform.z[eid]).toBeLessThan(10); // gravity pulled it down
      expect(Transform.qw[eid]).toBeCloseTo(1); // unrotated
      physics.dispose();
    });
  });
});
