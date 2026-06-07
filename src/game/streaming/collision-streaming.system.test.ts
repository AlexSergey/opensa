import { describe, expect, it, type Mock, vi } from 'vitest';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { CollisionStreamingSystem } from './collision-streaming.system';

function config(collisionDrawDistance: number): Config {
  return {
    camera: { followDistance: 12, followMaxPolar: 1.5, followMinPolar: 0.25, followZoom: true },
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
    debugMode: false,
    gameState: 'play',
    movement: { accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 6, runSpeed: 26, walkSpeed: 10 },
    showCollision: false,
    showLogs: false,
    staticUrl: '',
    streaming: { cellSize: 250, collisionDrawDistance, hdDrawDistance: 300, lodDrawDistance: 1500 },
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
