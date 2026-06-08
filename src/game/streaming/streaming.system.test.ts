import { Object3D } from 'three';
import { describe, expect, it, type Mock, vi } from 'vitest';

import type { Config } from '../interfaces/config.interface';
import type { CellRequest, Vec3 } from '../interfaces/world-adapter.interface';

import { StreamingSystem } from './streaming.system';

function config(overrides: Partial<Config> = {}): Config {
  return {
    camera: { followDistance: 12, followMaxPolar: 1.5, followMinPolar: 0.25, followZoom: true },
    controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
    fog: { distance: 800 },
    fonts: { hud: { clock: 'SixCaps-Regular' } },
    gameState: 'play',
    graphics: {
      bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
      sky: { density: 0.96, exposure: 0.5, weight: 0.4 },
      sun: { godrays: true, godraysSize: 30, sunSize: 15 },
      toneMapping: false,
    },
    hud: { clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 } },
    mapViewer: false,
    movement: { accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 6, runSpeed: 26, walkSpeed: 10 },
    showCollision: false,
    showLogs: false,
    staticUrl: '',
    streaming: { cellSize: 250, collisionDrawDistance: 150, hdDrawDistance: 100, lodDrawDistance: 300 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
    ...overrides,
  };
}

function stubAdapter(): { cellSize: number; loadCell: Mock<(request: CellRequest) => Promise<Object3D[]>> } {
  return {
    cellSize: 250,
    loadCell: vi.fn((request: CellRequest): Promise<Object3D[]> => {
      const object = new Object3D();
      object.name = request.lod ? 'lod' : 'hd';

      return Promise.resolve([object]);
    }),
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('StreamingSystem', () => {
  describe('negative cases', () => {
    it('ignores a manual selection while not in debug mode (keeps streaming)', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      const system = new StreamingSystem(adapter, root, () => [125, 125, 0] as Vec3, config());
      system.setManualCells([[5, 5]], true);

      system.update();
      await flush();

      expect(root.children).toHaveLength(9); // the stream rings, not the 1 manual cell
      expect(adapter.loadCell.mock.calls.some(([req]) => req.cx === 5)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('streams HD in the near ring and LOD in the outer ring', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      const system = new StreamingSystem(adapter, root, () => [125, 125, 0] as Vec3, config());

      system.update();
      await flush();

      // hd 100 → cell (0,0); lod 300 → 3×3 block minus (0,0) = 8 LOD cells
      expect(root.children.filter((c) => c.name === 'hd')).toHaveLength(1);
      expect(root.children.filter((c) => c.name === 'lod')).toHaveLength(8);
    });

    it('unloads cells that leave the view and loads the new ones', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 125, 0];
      const system = new StreamingSystem(adapter, root, () => view, config());

      system.update();
      await flush();
      const firstChildren = [...root.children];

      view = [100125, 100125, 0]; // centre of a far cell (same ring shape elsewhere)
      system.update();
      await flush();

      expect(root.children.some((c) => firstChildren.includes(c))).toBe(false); // old gone
      expect(root.children).toHaveLength(firstChildren.length); // same ring size elsewhere
    });

    it('renders only the manual cells while in debug mode', async () => {
      const adapter = stubAdapter();
      const root = new Object3D();
      const system = new StreamingSystem(adapter, root, () => [0, 0, 0] as Vec3, config({ mapViewer: true }));
      system.setManualCells(
        [
          [5, 5],
          [6, 5],
        ],
        true,
      );

      system.update();
      await flush();

      expect(root.children).toHaveLength(2);
      expect(adapter.loadCell.mock.calls.map(([req]) => req)).toContainEqual({
        cx: 5,
        cy: 5,
        lod: true,
      });
    });
  });
});
