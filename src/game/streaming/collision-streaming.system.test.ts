import { describe, expect, it, type Mock, vi } from 'vitest';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { CollisionStreamingSystem } from './collision-streaming.system';

function config(collisionDrawDistance: number): Config {
  return {
    camera: { followDistance: 12, followMaxPolar: 1.5, followMinPolar: 0.25, followZoom: true },
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
    fog: { distance: 800 },
    fonts: { hud: { clock: 'SixCaps-Regular' } },
    gameState: 'play',
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      clouds: { coverage: 0.5, opacity: 0.85 },
      headlights: { angle: Math.PI / 7, distance: 35, glow: 0.15, intensity: 8 },
      lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
      moon: { brightness: 1, elevationDeg: 35, size: 150 },
      night: {
        coronaDrawDistance: 120,
        grade: 0.7,
        skylight: 0.6,
        tint: [0.6, 0.66, 0.85],
        windowGlow: 1,
      },
      shadows: { enabled: true },
      sky: { density: 0.96, exposure: 0.5, weight: 0.4 },
      ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
      stars: { enabled: true },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: false,
      vehicleReflection: { intensity: 1, preset: 'enhanced' },
      water: { darkness: 0.55, glint: 1.5, reflection: 0.6 },
    },
    hud: { clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 } },
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
  createStaticColliders: Mock<(models: readonly ModelColliders[]) => number[]>;
  removeBodies: Mock<(handles: readonly number[]) => void>;
} {
  let nextHandle = 0;

  return {
    createStaticColliders: vi.fn((models: readonly ModelColliders[]): number[] => models.map(() => nextHandle++)),
    removeBodies: vi.fn<(handles: readonly number[]) => void>(),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('CollisionStreamingSystem', () => {
  describe('positive cases', () => {
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
  });
});
