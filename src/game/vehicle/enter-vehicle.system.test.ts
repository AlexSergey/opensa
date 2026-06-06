import { Object3D, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';

import type { CharacterAnimationSystem } from '../character/character-animation.system';
import type { CharacterControllerSystem } from '../character/character-controller.system';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld } from '../physics/physics-world';
import type { EnterableVehicle } from './enter-vehicle.system';

import { EnterVehicleSystem } from './enter-vehicle.system';

interface Harness {
  anim: { cameraAzimuth: number; clip: null | string; facing: number; loop: boolean };
  ctrl: { arrived: boolean; enabled: boolean; path: null | Vec3[] };
  phys: { teleports: Vec3[] };
  press: (down: boolean) => void;
  system: EnterVehicleSystem;
}

/** How far the driver door has swung from closed. */
function doorAngle(vehicle: EnterableVehicle): number {
  return vehicle.doors[0].pivot.quaternion.angleTo(new Quaternion());
}

function setup(player: Vec3 = [0, 0, 0]): Harness {
  const kb = { down: false };
  const keyboard = { isDown: (code: string): boolean => code === 'Enter' && kb.down };

  const ctrl = { arrived: false, enabled: true, path: null as null | Vec3[] };
  const controller = {
    get arrived(): boolean {
      return ctrl.arrived;
    },
    runPath(points: Vec3[]): void {
      ctrl.path = points;
    },
    setEnabled(enabled: boolean): void {
      ctrl.enabled = enabled;
    },
  } as unknown as CharacterControllerSystem;

  const phys = { teleports: [] as Vec3[] };
  const physics = {
    teleport: (_handle: number, position: Vec3) => phys.teleports.push(position),
  } as unknown as PhysicsWorld;

  const anim = { cameraAzimuth: 0, clip: null as null | string, facing: 0, loop: true };
  const animation = {
    faceTo(yaw: number): void {
      anim.facing = yaw;
    },
    setScripted(clip: null | string, options: { loop?: boolean } = {}): void {
      anim.clip = clip;
      anim.loop = options.loop ?? true;
    },
  } as unknown as CharacterAnimationSystem;

  const system = new EnterVehicleSystem(
    keyboard,
    () => player,
    controller,
    physics,
    7,
    animation,
    (yaw) => {
      anim.cameraAzimuth = yaw;
    },
  );

  return {
    anim,
    ctrl,
    phys,
    press: (down): void => {
      kb.down = down;
    },
    system,
  };
}

/** Car with hinge at the body origin, half-extents [1, 2], driver seat at [-0.4, 0, -0.16]. */
function vehicleAt(position: Vec3): EnterableVehicle {
  return {
    doors: [{ closed: new Quaternion(), pivot: new Object3D(), side: 'lf' }],
    halfExtents: [1, 2],
    heading: 0,
    position,
    seatLocal: [-0.4, 0, -0.16],
  };
}

describe('EnterVehicleSystem', () => {
  describe('negative cases', () => {
    it('does nothing without an Enter press', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));
      h.system.update(1);
      expect(h.ctrl.path).toBeNull();
    });

    it('ignores Enter when no car is in range', () => {
      const h = setup();
      h.system.add(vehicleAt([10, 0, 0])); // beyond ENTER_RANGE
      h.press(true);
      h.system.update(1);
      expect(h.ctrl.path).toBeNull();
    });

    it('keeps the door shut until the player has reached it', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(1); // approaching, not arrived
      expect(doorAngle(car)).toBeCloseTo(0);
    });
  });

  describe('positive cases', () => {
    it('approaches the driver door directly from the driver side', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0])); // player local x = -2 (driver side) → straight
      h.press(true);
      h.system.update(1);
      expect(h.ctrl.path).toHaveLength(1);
      expect(h.ctrl.path?.[0][0]).toBeCloseTo(0.8); // entry = 2 + (0 - 1.2)
    });

    it('routes around the nearer bumper from the passenger side', () => {
      const h = setup();
      h.system.add(vehicleAt([-3, 0, 0])); // player on the +X (passenger) side in vehicle space
      h.press(true);
      h.system.update(1);
      expect(h.ctrl.path).toHaveLength(3);
    });

    it('opens the driver door once the player arrives', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // arrived → door swings open
      expect(doorAngle(car)).toBeCloseTo(Math.PI / 3);
    });

    it('steps into the doorway, climbs in (gates + getin clip), then sits and shuts the door', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // arrived → open door → step into the doorway
      h.system.update(0.016); // at the doorway → climb in
      expect(h.ctrl.enabled).toBe(false);
      expect(h.anim.clip).toBe('car_getin_lhs');

      h.system.update(2); // getin elapses → seated
      expect(h.anim.clip).toBe('car_sit');
      expect(h.phys.teleports.length).toBeGreaterThan(0);
      expect(h.anim.cameraAzimuth).toBeCloseTo(0); // heading 0 → camera behind the car's rear

      h.system.update(1); // door pulled shut
      expect(doorAngle(car)).toBeCloseTo(0);
    });

    it('seats the player facing the car forward (drive-ready)', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016);
      h.ctrl.arrived = true;
      h.system.update(1);
      h.system.update(0.016);
      h.system.update(2); // seated
      expect(h.anim.facing).toBeCloseTo(0); // faces car forward (+Y at heading 0)

      h.system.update(1); // door pulled shut
      expect(doorAngle(car)).toBeCloseTo(0);
    });

    it('exits the car on Enter: reopens, climbs out, restores control, shuts the door', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      // Enter and sit.
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // open → stepin
      h.system.update(0.016); // doorway → getin
      h.system.update(2); // → seated
      expect(h.anim.clip).toBe('car_sit');

      // Now exit.
      h.press(false);
      h.system.update(0.016); // release Enter
      h.press(true);
      h.system.update(0.016); // seated + Enter → reopen the door
      h.system.update(1); // door open → climb out
      expect(h.anim.clip).toBe('car_getout_lhs');
      expect(h.ctrl.enabled).toBe(false); // still gated mid-exit

      h.system.update(2); // climb-out elapses → control restored
      expect(h.ctrl.enabled).toBe(true);
      expect(h.anim.clip).toBeNull();
      expect(h.anim.facing).toBeCloseTo(Math.PI / 2); // heading 0 → faces −X, away from the car body
      expect(h.anim.cameraAzimuth).toBeCloseTo(Math.PI / 2); // camera swings behind, looking away from the car

      h.system.update(1); // door shut behind
      expect(doorAngle(car)).toBeCloseTo(0);
    });
  });
});
