import { Object3D, Quaternion, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld } from '../physics/physics-world';
import type { EnterableVehicle } from './enter-vehicle.system';
import type { VehicleRig } from './vehicle-rig';

import { VehiclePhysicsSystem } from './vehicle-physics.system';

interface Transform {
  position: Vec3;
  quaternion: [number, number, number, number];
}

const CAR_BODY = 3;

/** A physics world returning a settable body transform. */
function fakePhysics(transform: Transform): PhysicsWorld {
  return { readBody: (): Transform => transform } as unknown as PhysicsWorld;
}

/** A rig that records the last speed it was told to roll at. */
function fakeRig(): { rig: VehicleRig; speed: number } {
  const state = { rig: null as unknown as VehicleRig, speed: 0 };
  state.rig = {
    setSpeed: (value: number): void => {
      state.speed = value;
    },
    update: (): void => undefined,
  } as unknown as VehicleRig;

  return state;
}

function vehicle(rig: VehicleRig, position: Vec3 = [0, 0, 0]): EnterableVehicle {
  return {
    body: CAR_BODY,
    heading: 0,
    object: new Object3D(),
    position: [...position],
    rig,
  } as unknown as EnterableVehicle;
}

/** Quaternion (as [x,y,z,w]) for a yaw of `angle` about GTA +Z. */
function yaw(angle: number): [number, number, number, number] {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);

  return [q.x, q.y, q.z, q.w];
}

describe('VehiclePhysicsSystem', () => {
  let rig: ReturnType<typeof fakeRig>;

  beforeEach(() => {
    rig = fakeRig();
  });

  describe('negative cases', () => {
    it('stops driving a removed vehicle', () => {
      const transform: Transform = { position: [5, 0, 0], quaternion: yaw(0) };
      const system = new VehiclePhysicsSystem(fakePhysics(transform));
      const car = vehicle(rig.rig);
      system.add(car);
      system.remove(car);
      transform.position = [99, 0, 0];
      system.update(1);
      expect(car.position[0]).toBe(0); // never copied from the body after removal
    });

    it('keeps a parked car wheels still (no displacement → speed 0)', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 0, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig));
      system.update(1); // body did not move from the add position
      expect(rig.speed).toBe(0);
    });

    it('treats sub-deadzone creep as still', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 0.05, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig));
      system.update(1); // 0.05 m/s < ROLL_DEADZONE (0.1)
      expect(rig.speed).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('copies the body transform onto the car and its object', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [10, 20, 30], quaternion: yaw(0) }));
      const car = vehicle(rig.rig);
      system.add(car);
      system.update(1);
      expect(car.position).toEqual([10, 20, 30]);
      expect(car.object.position.toArray()).toEqual([10, 20, 30]);
    });

    it('derives heading about Z from the body forward (+Y)', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 0, 0], quaternion: yaw(Math.PI / 2) }));
      const car = vehicle(rig.rig);
      system.add(car);
      system.update(1);
      expect(car.heading).toBeCloseTo(Math.PI / 2, 5);
    });

    it('rolls the wheels forward at the car planar speed', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 2, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig)); // added at [0,0,0]; body now at [0,2,0]
      system.update(1); // moved +2 in Y over 1s, facing +Y → +2 m/s
      expect(rig.speed).toBeCloseTo(2, 5);
    });

    it('signs the roll negative when moving against the facing (reversing)', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, -2, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig)); // facing +Y but moving −Y
      system.update(1);
      expect(rig.speed).toBeCloseTo(-2, 5);
    });
  });
});
