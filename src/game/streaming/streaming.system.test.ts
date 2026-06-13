import { Object3D } from 'three';
import { describe, expect, it, type Mock, vi } from 'vitest';

import type { Config } from '../interfaces/config.interface';
import type { CellRequest, Vec3 } from '../interfaces/world-adapter.interface';

import { StreamingSystem } from './streaming.system';

function config(overrides: Partial<Config> = {}): Config {
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
      headlights: {
        coronaIntensity: 0.8,
        coronaSize: 0.28,
        intensity: 1,
      },
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
    streaming: { cellSize: 250, collisionDrawDistance: 150, hdDrawDistance: 100, lodDrawDistance: 300 },
    time: { secondsPerGameMinute: 3 },
    vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
    weatherTransitionSeconds: 0,
    ...overrides,
  };
}

/** Adapter whose loaded objects are named by their full stream key, so a specific cell+level is
 *  findable in the root (`0,0,hd` / `0,0,lod`). */
function keyedAdapter(): { cellSize: number; loadCell: Mock<(request: CellRequest) => Promise<Object3D[]>> } {
  return {
    cellSize: 250,
    loadCell: vi.fn((request: CellRequest): Promise<Object3D[]> => {
      const object = new Object3D();
      object.name = `${request.cx},${request.cy},${request.lod ? 'lod' : 'hd'}`;

      return Promise.resolve([object]);
    }),
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

const has = (root: Object3D, key: string): boolean => root.children.some((c) => c.name === key);

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

    it('keeps the LOD cell until its HD replacement loads, then swaps (no empty frame)', async () => {
      const adapter = keyedAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 400, 0]; // cell (0,0) is ~150 away → LOD
      const system = new StreamingSystem(adapter, root, () => view, config());

      system.update();
      await flush();
      expect(has(root, '0,0,lod')).toBe(true);
      expect(has(root, '0,0,hd')).toBe(false);

      view = [125, 125, 0]; // now inside cell (0,0) → HD desired
      system.update(); // HD load STARTED but not resolved yet
      expect(has(root, '0,0,lod')).toBe(true); // LOD held → no hole while HD loads
      expect(has(root, '0,0,hd')).toBe(false);

      await flush(); // HD resolves → added, LOD removed in the same step
      expect(has(root, '0,0,hd')).toBe(true);
      expect(has(root, '0,0,lod')).toBe(false);
    });

    it('holds the current level across the hysteresis dead-band (no flip-flop at the boundary)', async () => {
      const adapter = keyedAdapter();
      const root = new Object3D();
      let view: Vec3 = [125, 125, 0]; // inside cell (0,0) → HD
      const system = new StreamingSystem(adapter, root, () => view, config());

      system.update();
      await flush();
      expect(has(root, '0,0,hd')).toBe(true);

      // Move to ~130 from cell (0,0): past hdDrawDistance (100) but within the dead-band
      // (hd 100 + 250×0.25 = 162.5), so an already-HD cell stays HD instead of downgrading to LOD.
      view = [125, 380, 0];
      system.update();
      await flush();
      expect(has(root, '0,0,hd')).toBe(true);
      expect(has(root, '0,0,lod')).toBe(false);
      expect(adapter.loadCell.mock.calls.some(([r]) => r.cx === 0 && r.cy === 0 && r.lod)).toBe(false);
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
