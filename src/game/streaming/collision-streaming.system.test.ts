import { describe, expect, it, type Mock, vi } from 'vitest';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { CollisionStreamingSystem } from './collision-streaming.system';

function config(collisionDrawDistance: number): Config {
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
    gameState: 'play',
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
    streaming: { cellSize: 250, collisionDrawDistance, hdDrawDistance: 300, lodDrawDistance: 1500 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
    weatherTransitionSeconds: 0,
  };
}

function modelColliders(name: string): ModelColliders {
  return {
    name,
    shape: { boxes: [], indices: new Uint32Array(), spheres: [], vertices: new Float32Array() },
    transforms: [],
  };
}

function stubAdapter(): {
  cellSize: number;
  loadCellColliders: Mock<(cx: number, cy: number) => Promise<ModelColliders[]>>;
} {
  return {
    cellSize: 250,
    loadCellColliders: vi.fn(
      (cx: number, cy: number): Promise<ModelColliders[]> => Promise.resolve([modelColliders(`${cx},${cy}`)]),
    ),
  };
}

function stubPhysics(): {
  createStaticColliders: Mock<
    (models: readonly ModelColliders[], onBreakable?: (key: string, handle: number) => void) => number[]
  >;
  removeBodies: Mock<(handles: readonly number[]) => void>;
} {
  let nextHandle = 0;

  return {
    createStaticColliders: vi.fn(
      (models: readonly ModelColliders[], onBreakable?: (key: string, handle: number) => void): number[] =>
        models.map((model) => {
          const handle = nextHandle++;
          for (const key of model.instanceKeys ?? []) {
            onBreakable?.(key, handle);
          }

          return handle;
        }),
    ),
    removeBodies: vi.fn<(handles: readonly number[]) => void>(),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('CollisionStreamingSystem', () => {
  describe('negative cases', () => {
    it('removeBreakable is a no-op for an unknown key', () => {
      const system = new CollisionStreamingSystem(stubAdapter(), stubPhysics(), () => [0, 0, 0] as Vec3, config(100));
      expect(system.removeBreakable('nope')).toBe(false);
    });

    it('breakableKeyOf returns undefined for a null or unknown body handle', () => {
      const system = new CollisionStreamingSystem(stubAdapter(), stubPhysics(), () => [0, 0, 0] as Vec3, config(100));
      expect(system.breakableKeyOf(null)).toBeUndefined();
      expect(system.breakableKeyOf(999)).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('drops a smashed breakable body without disturbing the rest of the cell', async () => {
      const adapter = stubAdapter();
      adapter.loadCellColliders.mockImplementation((cx, cy) =>
        Promise.resolve([{ ...modelColliders(`${cx},${cy}`), instanceKeys: ['bin@0'] }]),
      );
      const physics = stubPhysics();
      const system = new CollisionStreamingSystem(adapter, physics, () => [125, 125, 0] as Vec3, config(100));

      system.update();
      await flush();

      expect(system.breakableKeyOf(0)).toBe('bin@0'); // contact-force impact resolves the prop
      expect(system.removeBreakable('bin@0')).toBe(true);
      expect(physics.removeBodies).toHaveBeenCalledWith([0]); // only the prop's body
      expect(system.breakableKeyOf(0)).toBeUndefined(); // reverse lookup cleared
      expect(system.removeBreakable('bin@0')).toBe(false); // already gone
    });

    it('creates static colliders for cells within the radius', async () => {
      const adapter = stubAdapter();
      const physics = stubPhysics();
      const system = new CollisionStreamingSystem(adapter, physics, () => [125, 125, 0] as Vec3, config(100));

      system.update();
      await flush();

      expect(adapter.loadCellColliders).toHaveBeenCalledWith(0, 0);
      expect(physics.createStaticColliders).toHaveBeenCalledTimes(1);
    });

    it('removes a cell’s bodies when the view leaves it and loads the new cell', async () => {
      const adapter = stubAdapter();
      const physics = stubPhysics();
      let view: Vec3 = [125, 125, 0];
      const system = new CollisionStreamingSystem(adapter, physics, () => view, config(100));

      system.update();
      await flush();

      view = [100125, 100125, 0]; // a far cell (400, 400)
      system.update();
      await flush();

      expect(physics.removeBodies).toHaveBeenCalledWith([0]); // the old cell's handles freed
      expect(adapter.loadCellColliders).toHaveBeenCalledWith(400, 400);
    });

    it('reload drops every loaded cell and re-streams it on the next update', async () => {
      const adapter = stubAdapter();
      const physics = stubPhysics();
      const system = new CollisionStreamingSystem(adapter, physics, () => [125, 125, 0] as Vec3, config(100));

      system.update();
      await flush();
      expect(adapter.loadCellColliders).toHaveBeenCalledTimes(1);

      system.reload(); // clutter knobs changed — physics must match the new rendered set
      expect(physics.removeBodies).toHaveBeenCalledWith([0]);

      system.update();
      await flush();
      expect(adapter.loadCellColliders).toHaveBeenCalledTimes(2); // same cell rebuilt
    });
  });
});
