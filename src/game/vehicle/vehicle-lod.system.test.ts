import { Group, Mesh } from 'three';
import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { type SpawnedVehicle, VehicleLodSystem, type VehiclePlacement } from './vehicle-lod.system';

const CONFIG = { vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 } } as unknown as Readonly<Config>;
const PLACEMENT: VehiclePlacement = { heading: 0, model: 'admiral', position: [0, 0, 0] };

/** A car spawned at `position`: an HD mesh + a hidden `lod` group under one object. */
function makeCar(position: Vec3, despawn = vi.fn()): { hd: Mesh; lod: Group; spawned: SpawnedVehicle } {
  const object = new Group();
  const hd = new Mesh();
  hd.name = 'chassis';
  const lod = new Group();
  lod.name = 'lod';
  lod.visible = false;
  object.add(hd, lod);

  return { hd, lod, spawned: { despawn, lod, object, position } };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('VehicleLodSystem', () => {
  describe('negative cases', () => {
    it('culls the car (hides it) beyond lodDistance, without unloading it', () => {
      const car = makeCar([300, 0, 0]);
      const spawn = vi.fn();
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, spawn);
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(car.spawned.object.visible).toBe(false);
      expect(car.spawned.despawn).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('does not respawn a car that is still loaded and in range', () => {
      const car = makeCar([10, 0, 0]);
      const spawn = vi.fn();
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, spawn);
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('positive cases', () => {
    it('shows the HD body within hdDistance', () => {
      const car = makeCar([10, 0, 0]);
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, vi.fn());
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(car.spawned.object.visible).toBe(true);
      expect(car.hd.visible).toBe(true);
      expect(car.lod.visible).toBe(false);
    });

    it('swaps to the _vlo between hdDistance and lodDistance', () => {
      const car = makeCar([150, 0, 0]);
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, vi.fn());
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(car.lod.visible).toBe(true);
      expect(car.hd.visible).toBe(false);
    });

    it('unloads the car beyond unloadDistance', () => {
      const despawn = vi.fn();
      const car = makeCar([600, 0, 0], despawn);
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, vi.fn());
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(despawn).toHaveBeenCalledOnce();
      system.update(); // already unloaded → no second despawn
      expect(despawn).toHaveBeenCalledOnce();
    });

    it('respawns an unloaded car once the view returns within lodDistance', async () => {
      let view: Vec3 = [600, 0, 0];
      const respawned = makeCar([0, 0, 0]);
      const spawn = vi.fn(async () => Promise.resolve(respawned.spawned));
      const system = new VehicleLodSystem(() => view, CONFIG, spawn);
      system.add(PLACEMENT, makeCar([0, 0, 0]).spawned);

      system.update(); // far → unload
      view = [10, 0, 0];
      system.update(); // back in range → kick off respawn
      expect(spawn).toHaveBeenCalledOnce();

      await flush();
      system.update(); // respawned car now shown HD
      expect(respawned.spawned.object.visible).toBe(true);
      expect(respawned.hd.visible).toBe(true);
    });
  });
});
