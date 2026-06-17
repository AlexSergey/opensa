import { Object3D, Quaternion } from 'three';
import { describe, expect, it } from 'vitest';

import type { CharacterAnimationSystem } from '../character/character-animation.system';
import type { CharacterControllerSystem } from '../character/character-controller.system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld, VehicleController } from '../physics/physics-world';
import type { EnterableVehicle } from './enter-vehicle.system';
import type { VehicleRig } from './vehicle-rig';

import { Logger } from '../diagnostics/logger';
import { EnterVehicleSystem } from './enter-vehicle.system';

const CONTROLS = { back: 'KeyS', forward: 'KeyW', left: 'KeyA', right: 'KeyD' };

/** Silent logger (showLogs off → never emits) for systems under test. */
const SILENT_LOGGER = new Logger({ emit: (): undefined => undefined }, { showLogs: false });

interface Harness {
  anim: { cameraAzimuth: number; clip: null | string; facing: number; loop: boolean };
  ctrl: { arrived: boolean; enabled: boolean; path: null | Vec3[] };
  hold: (code: string, down: boolean) => void;
  phys: { brake: number; engine: number; parked: number; speed: number; steer: number; teleports: Vec3[] };
  press: (down: boolean) => void;
  system: EnterVehicleSystem;
}

/** How far the driver door has swung from closed. */
function doorAngle(vehicle: EnterableVehicle): number {
  return vehicle.doors[0].pivot.quaternion.angleTo(new Quaternion());
}

/** Run the full enter sequence so the system ends seated (Enter released, ready to drive). */
function seatPlayer(h: Harness, car: EnterableVehicle): void {
  h.system.add(car);
  h.press(true);
  h.system.update(0.016); // approaching
  h.ctrl.arrived = true;
  h.system.update(1); // arrived → open → step into the doorway
  h.system.update(0.016); // doorway → climb in (phase 'getin')
  h.system.fixedUpdate(2); // getin slide elapses (fixed step) → seated
  h.press(false);
  h.system.update(0.016); // release Enter so driving runs (no exit edge)
}

function setup(player: Vec3 = [0, 0, 0]): Harness {
  const held = new Set<string>();
  const keyboard = { isDown: (code: string): boolean => held.has(code) };

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

  const phys = { brake: 0, engine: 0, parked: 0, speed: 0, steer: 0, teleports: [] as Vec3[] };
  const placePlayer = (position: Vec3): void => {
    phys.teleports.push(position);
  };
  const physics = {
    getLinvel: (): Vec3 => [0, phys.speed, 0], // heading 0 → forward speed = vy
    holdBody: (): undefined => undefined,
    ignoreVehicles: (): undefined => undefined,
    parkVehicle: (): void => {
      phys.parked += 1;
    },
    readBody: (): { position: Vec3; quaternion: [number, number, number, number] } => ({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
    }),
    seedReverse: (): undefined => undefined,
    setColliderSensor: (): undefined => undefined,
    setVehicleControls: (_c: VehicleController, _w: unknown, engine: number, brake: number, steer: number): void => {
      phys.engine = engine;
      phys.brake = brake;
      phys.steer = steer;
    },
    vehicleSpeed: (): number => phys.speed,
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

  const aimCamera = (yaw: number): void => {
    anim.cameraAzimuth = yaw;
  };
  const system = new EnterVehicleSystem(
    keyboard,
    () => player,
    controller,
    placePlayer,
    animation,
    aimCamera,
    () => undefined, // followTarget (camera) — unused in tests
    { controls: CONTROLS } as unknown as Readonly<Config>,
    physics,
    9,
    SILENT_LOGGER,
  );

  const hold = (code: string, down: boolean): void => {
    if (down) {
      held.add(code);
    } else {
      held.delete(code);
    }
  };

  return { anim, ctrl, hold, phys, press: (down): void => hold('Enter', down), system };
}

/** Car with hinge at the body origin, half-extents [1, 2], driver seat at [-0.4, 0, -0.16]. */
function vehicleAt(position: Vec3): EnterableVehicle {
  const rig = { setSpeed: (): undefined => undefined, setSteer: (): undefined => undefined } as unknown as VehicleRig;

  return {
    body: 0,
    controller: {} as unknown as VehicleController,
    doors: [{ closed: new Quaternion(), pivot: new Object3D(), side: 'lf' }],
    halfExtents: [1, 2, 0.7],
    handling: { brakeDecel: 9, engineAccel: 20, mass: 1500, maxVelocity: 160, steeringLock: 30 },
    heading: 0,
    object: new Object3D(),
    position,
    rig,
    seatLocal: [-0.4, 0, -0.16],
    wheels: [
      { connection: [0.8, 1.5, -0.4], front: true, radius: 0.4 },
      { connection: [-0.8, 1.5, -0.4], front: true, radius: 0.4 },
      { connection: [-0.8, -1.5, -0.4], front: false, radius: 0.4 },
      { connection: [0.8, -1.5, -0.4], front: false, radius: 0.4 },
    ],
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

    it('does not cancel once climbing in (movement input ignored mid-getin)', () => {
      const h = setup();
      const car = vehicleAt([2, 0, 0]);
      h.system.add(car);
      h.press(true);
      h.system.update(0.016); // approaching
      h.ctrl.arrived = true;
      h.system.update(1); // arrived → open → step into the doorway
      h.system.update(0.016); // doorway → climb in (phase 'getin', scripted)
      expect(h.ctrl.enabled).toBe(false);

      h.press(false);
      h.hold('KeyW', true); // try to bail out mid-getin
      h.system.update(0.5);
      h.system.fixedUpdate(2); // getin completes regardless of input
      expect(h.anim.clip).toBe('car_sit'); // committed to seating, not cancelled
    });

    it('does not drive while not seated', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      h.system.fixedUpdate(0.1); // idle, not in the car
      expect(h.phys.engine).toBe(0);
    });

    it('applies no engine force when seated off-throttle (coast brake only)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.system.fixedUpdate(0.1); // seated, no keys
      expect(h.phys.engine).toBe(0);
      expect(h.phys.brake).toBeGreaterThan(0); // light idle brake
    });

    it('does not report braking on foot or while merely coasting off-throttle', () => {
      const h = setup();
      expect(h.system.isBraking()).toBe(false); // on foot
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 5; // rolling forward, no keys → idle coast brake, not real braking
      h.system.fixedUpdate(0.1);
      expect(h.system.isBraking()).toBe(false);
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

    it('hands control back when the player feeds movement during the run-up (after a short hold)', () => {
      const h = setup();
      h.system.add(vehicleAt([2, 0, 0]));
      h.press(true);
      h.system.update(0.016); // begin approach
      expect(h.ctrl.path).toHaveLength(1); // running to the door
      h.press(false); // release Enter
      h.hold('KeyW', true); // player takes over

      h.system.update(0.1); // held 0.1 s < threshold → still auto-running
      expect(h.ctrl.path).toHaveLength(1);
      h.system.update(0.1); // held 0.2 s ≥ threshold → control returns
      expect(h.ctrl.path).toEqual([]); // empty path = manual control restored
    });

    it('auto-cancels the run-up when the path is blocked (no progress), so Tommy stops running in place', () => {
      const h = setup(); // player position is fixed → never progresses toward the door
      h.system.add(vehicleAt([2, 0, 0]));
      h.press(true);
      h.system.update(0.016); // approaching
      h.press(false);
      expect(h.ctrl.path).toHaveLength(1);

      h.system.update(1); // ~1 s stalled, under the timeout → still running
      expect(h.ctrl.path).toHaveLength(1);
      h.system.update(1); // ~2 s stalled, over the timeout → cancelled
      expect(h.ctrl.path).toEqual([]);
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

      h.system.fixedUpdate(2); // getin slide elapses (fixed step) → seated
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
      h.system.fixedUpdate(2); // seated
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
      h.system.fixedUpdate(2); // getin slide (fixed step) → seated
      expect(h.anim.clip).toBe('car_sit');

      // Now exit (stationary → coast-to-stop completes immediately on the fixed step).
      h.press(false);
      h.system.update(0.016); // release Enter
      h.press(true);
      h.system.update(0.016); // seated + Enter → 'stopping'
      h.system.fixedUpdate(0.016); // already stopped → begin exit (open the door)
      h.system.update(1); // door open → climb out (phase 'exiting')
      expect(h.anim.clip).toBe('car_getout_lhs');
      expect(h.ctrl.enabled).toBe(false); // still gated mid-exit

      h.system.fixedUpdate(2); // climb-out slide (fixed step) → control restored
      expect(h.ctrl.enabled).toBe(true);
      expect(h.anim.clip).toBeNull();
      expect(h.anim.facing).toBeCloseTo(Math.PI / 2); // heading 0 → faces −X, away from the car body
      expect(h.anim.cameraAzimuth).toBeCloseTo(Math.PI / 2); // camera swings behind, looking away from the car

      h.system.update(1); // door shut behind
      expect(doorAngle(car)).toBeCloseTo(0);
    });

    it('drives forward on throttle', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyW', true);
      h.system.fixedUpdate(0.1);
      expect(h.phys.engine).toBeGreaterThan(0);
      expect(h.phys.brake).toBe(0);
    });

    it('brakes when reversing key is held while moving forward', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 5; // already rolling forward
      h.hold('KeyS', true);
      h.system.fixedUpdate(0.1);
      expect(h.phys.brake).toBeGreaterThan(0);
      expect(h.phys.engine).toBe(0);
    });

    it('reverses when back is held at rest', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 0;
      h.hold('KeyS', true);
      h.system.fixedUpdate(0.1);
      expect(h.phys.engine).toBeLessThan(0);
    });

    it('steers the front wheels toward the input', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.hold('KeyD', true);
      h.system.fixedUpdate(0.2);
      h.system.fixedUpdate(0.2);
      expect(h.phys.steer).not.toBe(0);
    });

    it('parks the car (brakes to a stop) when the player begins exiting', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.press(true);
      h.system.update(0.016); // seated + Enter → 'stopping'
      h.system.fixedUpdate(0.016); // stationary → startExit parks the car
      expect(h.phys.parked).toBeGreaterThan(0);
    });

    it('coasts to a stop before exiting when moving (does not exit a moving car)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 10; // moving forward
      h.press(true);
      h.system.update(0.016); // → 'stopping'
      h.system.fixedUpdate(0.016); // still moving → brakes, stays in the car
      expect(h.phys.brake).toBeGreaterThan(0);
      expect(h.phys.parked).toBe(0); // not exited yet
      h.phys.speed = 0; // now stopped
      h.system.fixedUpdate(0.016); // → startExit
      expect(h.phys.parked).toBeGreaterThan(0);
    });

    it('reports braking when pressing back while rolling forward (brake lights on)', () => {
      const h = setup();
      seatPlayer(h, vehicleAt([2, 0, 0]));
      h.phys.speed = 5; // rolling forward
      h.hold(CONTROLS.back, true); // S while moving forward → full brake
      h.system.fixedUpdate(0.1);
      expect(h.system.isBraking()).toBe(true);
    });
  });
});
