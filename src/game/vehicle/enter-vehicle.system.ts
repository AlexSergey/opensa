import type { Object3D } from 'three';

import { Quaternion, Vector3 } from 'three';

import type { CharacterAnimationSystem } from '../character/character-animation.system';
import type { CharacterControllerSystem } from '../character/character-controller.system';
import type { System } from '../core/system';
import type { Logger } from '../diagnostics/logger';
import type { KeyboardInput } from '../input/keyboard';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, VehicleHandling, VehicleWheelPlacement } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld, VehicleController } from '../physics/physics-world';
import type { VehicleDoor } from './vehicle-door';
import type { VehicleRig } from './vehicle-rig';

import { setDoorAngle } from './vehicle-door';

/** A car the player can interact with + sit in (driver side). It is a dynamic
 * physics body; `position`/`heading` are kept live by the vehicle-physics system. */
export interface EnterableVehicle {
  /** Chassis rigid-body handle (dynamic). */
  body: number;
  /** Raycast vehicle controller (drive/brake/steer). */
  controller: VehicleController;
  doors: VehicleDoor[];
  /** Half-extents in vehicle space `[hx, hy, hz]` (routing uses x/y). */
  halfExtents: [number, number, number];
  /** Driving feel from handling.cfg. */
  handling: VehicleHandling;
  /** Heading about Z (native) — kept live from the body by the physics system. */
  heading: number;
  /** The renderable car (under the streaming root); its transform follows the body. */
  object: Object3D;
  /** World position (native Z-up) — kept live from the body by the physics system. */
  position: Vec3;
  /** Wheel rig (spin/steer). */
  rig: VehicleRig;
  /** Driver seat position in vehicle space `[x, y, z]` (mirrored to the −X driver side). */
  seatLocal: [number, number, number];
  /** Raycast wheel placements (front flags for steering/drive). */
  wheels: VehicleWheelPlacement[];
}

const ENTER_KEY = 'Enter';
/** Planar distance (m) from the car within which Enter starts the sequence. */
const ENTER_RANGE = 4;
/** How far out from the hinge (m, driver −X side) the player stands to open the door. */
const DOOR_STANDOFF = 1.2;
/** Extra clearance (m) past a bumper when routing around the car. */
const END_MARGIN = 1.2;
/** Clearance (m) outside the body where the player stands in the open doorway before climbing in. */
const DOORWAY_CLEAR = 0.35;
/** Driver-door open angle about the hinge (sign tuned in-browser). */
const DOOR_OPEN_ANGLE = -Math.PI / 3;
/** Door swing speed (rad/s). */
const DOOR_SPEED = Math.PI;
/** Seconds the climb-in/out clip plays while the body slides between door and seat. */
const GETIN_DURATION = 1.2;
const GETOUT_DURATION = 1.2;
/** Capsule-centre height above the seat dummy (tuned in-browser). */
const SEAT_RAISE = 0;

const CAR_GETIN = 'car_getin_lhs';
const CAR_GETOUT = 'car_getout_lhs';
const CAR_SIT = 'car_sit';

// handling.cfg → driving forces (tuned in-browser). Engine/brake are forces (N) scaled from the
// car's mass + handling accel/decel; the controller (raycast wheels) integrates them.
const ENGINE_ACCEL_SCALE = 0.28; // engineAccel → target accel (m/s²) the engine force aims for
// Rapier's wheel brake is a small-scale value (NOT a Newton force like the engine): ~120/wheel
// already gives ~12 m/s² of braking, while ≳400/wheel over-constrains and pitches the body hard.
const BRAKE_FORCE = 480; // total brake split across wheels (≈120 each) at a reference brakeDecel
const BRAKE_DECEL_REF = 8.5; // handling.brakeDecel that maps to BRAKE_FORCE (others scale from it)
const REVERSE_FRACTION = 0.4; // reverse force/top-speed as a fraction of forward
const IDLE_BRAKE_FRACTION = 0.08; // light brake when off throttle, so the car coasts to a stop
const ENGINE_RAMP_TIME = 0.2; // seconds for the engine force to reach full (snappy but no force spike)
const MAXVEL_SCALE = 0.25; // handling.maxVelocity → top speed (m/s)
const MIN_TOP_SPEED = 8; // floor for top speed (m/s)
const REVERSE_SPEED_EPS = 0.6; // below this forward speed, S means reverse (else brake)
const REVERSE_SEED_SPEED = 1; // m/s backward to kick reverse off a dead stop
const STEER_RATE = 1.2; // steering slew (rad/s) — eased so the car doesn't snap into turns
const STEER_RECENTER_RATE = 2.4; // faster return to centre when the wheel is released
const STEER_SPEED_FALLOFF = 0.6; // fraction the steering lock shrinks toward top speed
const STEER_LOCK_SCALE = 0.6; // use only this fraction of the handling lock (gentler turn radius)
const UPRIGHT_MIN = 0.6; // car-up·world-up above this = upright enough for the normal door entry
const STOP_THRESHOLD = 0.8; // forward speed (m/s) below which the car counts as stopped (for exit)
const VEHICLE_CLEARANCE = 0.6; // how far outside the car footprint the player must be to re-collide

type Phase = 'approaching' | 'exiting' | 'exitopen' | 'getin' | 'idle' | 'opening' | 'seated' | 'stepin' | 'stopping';

/**
 * Drives the full "enter the car" sequence (driver side): from within
 * {@link ENTER_RANGE}, Enter runs the player around to the driver door, opens it,
 * plays the climb-in clip while sliding into the seat, then holds the seated pose
 * and shuts the door. While seated the player rides the (dynamic) car. The
 * character controller + locomotion animation are gated while scripted.
 */
export class EnterVehicleSystem implements System {
  readonly name = 'enter-vehicle';

  private active: EnterableVehicle | null = null;
  private readonly aimCamera: (azimuth: number) => void;
  private readonly animation: CharacterAnimationSystem;
  /** Whether the driver is actively braking (handbrake or braking forward motion) — for the brake lights. */
  private braking = false;
  private readonly config: Readonly<Config>;
  private readonly controller: CharacterControllerSystem;
  private readonly doors = new Map<EnterableVehicle, number>(); // current door angle
  private doorTarget = 0;
  private engine = 0; // current engine force (N), ramped toward the throttle target
  private enterHeld = false;
  private exitElapsed = 0;
  private exitFrom: Vec3 = [0, 0, 0];
  private exitTo: Vec3 = [0, 0, 0];
  /** Point the follow camera at the car while seated (null restores the player). */
  private readonly followTarget: (object: null | Object3D) => void;
  private getinElapsed = 0;
  private getinFrom: Vec3 = [0, 0, 0];
  private holdPos: Vec3 = [0, 0, 0]; // parked car pose, held still while the player slides in/out
  private holdQuat: [number, number, number, number] = [0, 0, 0, 1];
  private readonly keyboard: KeyboardInput;
  private readonly logger: Logger;
  private phase: Phase = 'idle';
  private readonly physics: PhysicsWorld;
  private readonly placePlayer: (position: Vec3, moveBody?: boolean) => void;
  private readonly playerCollider: number;
  private readonly playerPosition: () => Vec3;
  private restoreWhenClear = false; // after exit: re-enable car collision once the player is clear
  private readonly seatOffset = new Vector3(); // scratch: seat-local → world offset (rotated by the car)
  private readonly seatQuat = new Quaternion(); // scratch: car body orientation
  private seatWorld: Vec3 = [0, 0, 0];
  private steerAngle = 0; // current front-wheel steering (rad), slewed toward the input
  private readonly vehicles: EnterableVehicle[] = [];

  constructor(
    keyboard: KeyboardInput,
    playerPosition: () => Vec3,
    controller: CharacterControllerSystem,
    placePlayer: (position: Vec3, moveBody?: boolean) => void,
    animation: CharacterAnimationSystem,
    aimCamera: (azimuth: number) => void,
    followTarget: (object: null | Object3D) => void,
    config: Readonly<Config>,
    physics: PhysicsWorld,
    playerCollider: number,
    logger: Logger,
  ) {
    this.keyboard = keyboard;
    this.playerPosition = playerPosition;
    this.controller = controller;
    this.placePlayer = placePlayer;
    this.animation = animation;
    this.aimCamera = aimCamera;
    this.followTarget = followTarget;
    this.config = config;
    this.physics = physics;
    this.playerCollider = playerCollider;
    this.logger = logger;
  }

  add(vehicle: EnterableVehicle): void {
    this.vehicles.push(vehicle);
    this.doors.set(vehicle, 0);
  }

  /**
   * Driving + the seated rider run on the fixed step (lockstep with physics, after
   * the physics step and before render-sync) so the rider doesn't lag/jitter behind
   * the car: WSAD → engine/brake/steer, then snap the player onto the seat.
   */
  fixedUpdate(step: number): void {
    // All rider placement runs here (after the physics step, before render-sync) so render-sync
    // sees it the same frame AND the kinematic body is never teleported into the car (moveBody:
    // false) — a body inside the car shoves it (the entry/exit "pop").
    if (this.phase === 'getin') {
      this.advanceGetin(step);
    } else if (this.phase === 'exiting') {
      this.advanceGetout(step);
    } else if ((this.phase === 'seated' || this.phase === 'stopping') && this.active) {
      this.driveSeated(this.active, step);
    }
  }

  /** The car the player is currently in/entering (for debug actions like flip), or null on foot. */
  getActive(): EnterableVehicle | null {
    return this.active;
  }

  /** Whether the seated driver is braking right now (for the brake lights). False unless actively driving. */
  isBraking(): boolean {
    return this.isSeated() && this.braking;
  }

  /** Whether the player is seated in (driving) the active car — distinct from merely approaching/exiting. */
  isSeated(): boolean {
    return this.phase === 'seated' || this.phase === 'stopping';
  }

  /** Drop a (parked, unoccupied) car when it is unloaded. No-op if it is the active car. */
  remove(vehicle: EnterableVehicle): void {
    if (this.active === vehicle) {
      return;
    }
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
    this.doors.delete(vehicle);
  }

  update(delta: number): void {
    const pressed = this.keyboard.isDown(ENTER_KEY);
    const edge = pressed && !this.enterHeld;
    this.enterHeld = pressed;
    if (edge && this.phase === 'idle') {
      this.beginApproach();
    } else if (edge && this.phase === 'seated') {
      this.phase = 'stopping'; // brake to a halt first, then climb out (no exiting a moving car)
    }

    if (this.phase === 'approaching' && this.controller.arrived) {
      this.phase = 'opening';
      this.doorTarget = DOOR_OPEN_ANGLE;
    }
    // The getin/exiting slides + seated ride run on the fixed step (see fixedUpdate).
    this.animateDoor(delta);
    if (this.phase === 'opening' && this.doorAngleOf(this.active) === DOOR_OPEN_ANGLE) {
      this.startStepin();
    }
    if (this.phase === 'stepin' && this.controller.arrived) {
      this.startGetin();
    }
    if (this.phase === 'exitopen' && this.doorAngleOf(this.active) === DOOR_OPEN_ANGLE) {
      this.startGetout();
    }
    // After exiting, only let the player collide with cars again once he's stepped clear —
    // restoring it while he still overlaps the body would shove the (dynamic) car.
    if (this.restoreWhenClear && this.phase === 'idle' && this.active && this.playerClearOf(this.active)) {
      this.physics.ignoreVehicles(this.playerCollider, false);
      this.restoreWhenClear = false;
    }
  }

  /** Slide the player from the door to the seat over the climb-in clip; then sit. */
  private advanceGetin(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.getinElapsed += delta;
    const t = Math.min(this.getinElapsed / GETIN_DURATION, 1);
    this.placePlayer([
      this.getinFrom[0] + (this.seatWorld[0] - this.getinFrom[0]) * t,
      this.getinFrom[1] + (this.seatWorld[1] - this.getinFrom[1]) * t,
      this.getinFrom[2] + (this.seatWorld[2] - this.getinFrom[2]) * t,
    ]);
    if (t >= 1) {
      this.startSeated();
    }
  }

  /** Slide the player from the seat back to the doorway over the climb-out clip; then finish. */
  private advanceGetout(delta: number): void {
    if (this.active) {
      this.physics.holdBody(this.active.body, this.holdPos, this.holdQuat); // pin the parked car
    }
    this.exitElapsed += delta;
    const t = Math.min(this.exitElapsed / GETOUT_DURATION, 1);
    this.placePlayer([
      this.exitFrom[0] + (this.exitTo[0] - this.exitFrom[0]) * t,
      this.exitFrom[1] + (this.exitTo[1] - this.exitFrom[1]) * t,
      this.exitFrom[2] + (this.exitTo[2] - this.exitFrom[2]) * t,
    ]);
    if (t >= 1) {
      this.finishExit();
    }
  }

  /** Move the active car's driver door toward {@link doorTarget}. */
  private animateDoor(delta: number): void {
    if (!this.active) {
      return;
    }
    const angle = this.doorAngleOf(this.active);
    if (angle === this.doorTarget) {
      return;
    }
    const remaining = this.doorTarget - angle;
    const next = angle + Math.sign(remaining) * Math.min(Math.abs(remaining), DOOR_SPEED * delta);
    this.doors.set(this.active, next);
    const driver = this.active.doors.find((door) => door.side === 'lf');
    if (driver) {
      setDoorAngle(driver, next);
    }
  }

  /** Keyboard axis from two keys: +1 positive, −1 negative, 0 neither/both. */
  private axis(positive: string, negative: string): number {
    return (this.keyboard.isDown(positive) ? 1 : 0) - (this.keyboard.isDown(negative) ? 1 : 0);
  }

  /** Lock onto the nearest in-range car and send the player to its driver door. */
  private beginApproach(): void {
    const [px, py] = this.playerPosition();
    let nearest: EnterableVehicle | null = null;
    let nearestDistance = ENTER_RANGE * ENTER_RANGE;
    for (const vehicle of this.vehicles) {
      // Can't get into an overturned / on-its-side car (must be roughly on its wheels).
      if (!this.isUpright(vehicle)) {
        continue;
      }
      const dx = vehicle.position[0] - px;
      const dy = vehicle.position[1] - py;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = vehicle;
      }
    }
    if (!nearest) {
      return;
    }

    this.active = nearest;
    this.phase = 'approaching';
    // Stop the player shoving the dynamic car while walking to the door / climbing in.
    this.physics.ignoreVehicles(this.playerCollider, true);
    this.restoreWhenClear = false; // entering again — keep ignoring cars
    this.controller.runPath(this.driverDoorPath(nearest));
    this.logger.debug('enter-vehicle', 'approach', { distance: Math.sqrt(nearestDistance) });
  }

  private doorAngleOf(vehicle: EnterableVehicle | null): number {
    return vehicle ? (this.doors.get(vehicle) ?? 0) : 0;
  }

  /** Standing spot in the open doorway, aligned with the seat (just outside the body). */
  private doorwayWorld(vehicle: EnterableVehicle): Vec3 {
    const [hx] = vehicle.halfExtents;

    return this.toWorld(vehicle, [-(hx + DOORWAY_CLEAR), vehicle.seatLocal[1]]);
  }

  /**
   * Drive the seated car from WSAD via the raycast controller: engine force toward
   * a handling-scaled top speed, braking / reverse on back, and slewed front-wheel
   * steering (lock shrinks with speed). Forces are integrated by the physics step.
   */
  private drive(car: EnterableVehicle, step: number): void {
    const { controls } = this.config;
    const stopping = this.phase === 'stopping'; // braking to a halt before the player climbs out
    const throttle = stopping ? 0 : this.axis(controls.forward, controls.back);
    const steerInput = stopping ? 0 : this.axis(controls.right, controls.left);
    const handbrake = stopping || this.keyboard.isDown(controls.jump); // Space = brake / handbrake
    const hnd = car.handling;
    // Real forward speed from the body's *horizontal* velocity (the controller's
    // currentVehicleSpeed carries a phantom ~0.95 at rest → would misread reverse).
    const [vx, vy] = this.physics.getLinvel(car.body);
    const speed = -vx * Math.sin(car.heading) + vy * Math.cos(car.heading);
    if (stopping && Math.abs(speed) <= STOP_THRESHOLD) {
      this.startExit(); // stopped → begin the climb-out

      return;
    }
    const topSpeed = Math.max(MIN_TOP_SPEED, hnd.maxVelocity * MAXVEL_SCALE);
    const engineForce = hnd.mass * hnd.engineAccel * ENGINE_ACCEL_SCALE;
    const brakeForce = BRAKE_FORCE * (hnd.brakeDecel / BRAKE_DECEL_REF);

    let targetEngine = 0;
    let brake = 0;
    if (handbrake) {
      brake = brakeForce; // Space overrides → brake to a stop / hold
    } else if (throttle > 0) {
      targetEngine = speed < topSpeed ? engineForce : 0;
    } else if (throttle < 0) {
      if (speed > REVERSE_SPEED_EPS) {
        brake = brakeForce; // moving forward → brake
      } else {
        // The raycast controller won't start reverse from a dead stop; seed a small
        // backward velocity until it's rolling, then the engine force sustains it.
        if (speed > -REVERSE_SEED_SPEED) {
          this.physics.seedReverse(car.body, car.heading, REVERSE_SEED_SPEED);
        }
        targetEngine = speed > -topSpeed * REVERSE_FRACTION ? -engineForce * REVERSE_FRACTION : 0;
      }
    } else {
      brake = brakeForce * IDLE_BRAKE_FRACTION; // coast to a stop off-throttle
    }
    // Brake lights: full braking only (handbrake / braking forward motion sets brake = brakeForce), not the
    // light idle-coast brake or reverse (which drives the engine, leaving brake at 0).
    this.braking = brake === brakeForce;

    // Ramp the engine force toward its target so sudden throttle doesn't jolt the
    // suspension (a visible launch hop); braking stays instant.
    const rampStep = (engineForce / ENGINE_RAMP_TIME) * step;
    this.engine += clamp(targetEngine - this.engine, -rampStep, rampStep);

    // Ease the steering toward the input (gentle turn-in, quicker return to centre);
    // the usable lock shrinks toward top speed so it doesn't twitch at speed.
    const speedFactor = Math.min(Math.abs(speed) / topSpeed, 1);
    const lock = ((hnd.steeringLock * Math.PI) / 180) * STEER_LOCK_SCALE * (1 - speedFactor * STEER_SPEED_FALLOFF);
    const target = -steerInput * lock; // D (right) turns the car right
    const rate = steerInput === 0 ? STEER_RECENTER_RATE : STEER_RATE;
    this.steerAngle += clamp(target - this.steerAngle, -rate * step, rate * step);

    this.physics.setVehicleControls(car.controller, car.wheels, this.engine, brake, this.steerAngle);
    car.rig.setSteer(this.steerAngle); // front wheels turn with the physics steer
  }

  /**
   * A world-space path (Z-up) to the driver-door standing spot. From the
   * passenger (+X) side it routes around the nearer bumper so the player doesn't
   * walk into the car; otherwise a straight approach.
   */
  private driverDoorPath(vehicle: EnterableVehicle): Vec3[] {
    const [hx, hy] = vehicle.halfExtents;
    const hinge = vehicle.doors.find((door) => door.side === 'lf')?.pivot.position;
    const entry: [number, number] = [(hinge?.x ?? -hx) - DOOR_STANDOFF, hinge?.y ?? 0]; // driver (−X) side
    const player = this.playerLocal(vehicle);

    const path: [number, number][] = [];
    if (player[0] > 0) {
      // Passenger side: go along the player's side to the nearer end, then cross over.
      const endY = (player[1] >= 0 ? 1 : -1) * (hy + END_MARGIN);
      path.push([player[0], endY], [entry[0], endY]);
    }
    path.push(entry);

    return path.map((local) => this.toWorld(vehicle, local));
  }

  /** Drive the seated car and snap the rider onto its (full-transform) seat. */
  private driveSeated(car: EnterableVehicle, step: number): void {
    const { position, quaternion } = this.physics.readBody(car.body);
    car.position[0] = position[0];
    car.position[1] = position[1];
    car.position[2] = position[2];
    car.heading = headingFromQuat(quaternion);
    this.drive(car, step);

    // Seat the rider via the car's FULL transform so he tilts/flips with it (not just yaw).
    this.seatQuat.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    this.seatOffset
      .set(car.seatLocal[0], car.seatLocal[1], car.seatLocal[2] + SEAT_RAISE)
      .applyQuaternion(this.seatQuat);
    this.placePlayer([
      position[0] + this.seatOffset.x,
      position[1] + this.seatOffset.y,
      position[2] + this.seatOffset.z,
    ]);
    this.animation.setScripted(CAR_SIT, { loop: true, orientation: quaternion });
  }

  /** Out of the car: restore manual control + locomotion, face away from the car, shut the door. */
  private finishExit(): void {
    const heading = this.active?.heading ?? 0;
    // Yaw facing out of the doorway (vehicle −X side), away from the car body.
    const outward = Math.atan2(Math.cos(heading), -Math.sin(heading));
    this.placePlayer(this.exitTo);
    this.followTarget(null); // back to following the player on foot
    this.animation.setScripted(null);
    this.animation.faceTo(outward);
    this.aimCamera(outward); // swing the camera behind the player so forward goes away from the car
    this.physics.setColliderSensor(this.playerCollider, false); // solid again — walking
    this.restoreWhenClear = true; // re-enable car collision once the player has stepped clear (update)
    this.controller.setEnabled(true);
    this.doorTarget = 0;
    this.phase = 'idle';
    this.logger.log('enter-vehicle', 'exited');
  }

  /** True if the car is roughly the right way up (its local +Z still points mostly up). */
  private isUpright(vehicle: EnterableVehicle): boolean {
    const [x, y] = this.physics.readBody(vehicle.body).quaternion;

    return 1 - 2 * (x * x + y * y) > UPRIGHT_MIN; // world-Z component of the body's local up
  }

  /** True once the player is outside the car's footprint (+ clearance) — safe to re-collide. */
  private playerClearOf(vehicle: EnterableVehicle): boolean {
    const [hx, hy] = vehicle.halfExtents;
    const [lx, ly] = this.playerLocal(vehicle);

    return Math.abs(lx) > hx + VEHICLE_CLEARANCE || Math.abs(ly) > hy + VEHICLE_CLEARANCE;
  }

  /** Player position in the vehicle's local frame (planar). */
  private playerLocal(vehicle: EnterableVehicle): [number, number] {
    const [px, py] = this.playerPosition();
    const dx = px - vehicle.position[0];
    const dy = py - vehicle.position[1];
    const cos = Math.cos(vehicle.heading);
    const sin = Math.sin(vehicle.heading);

    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  }

  /** World seat position (Z-up): seat dummy in vehicle space → world, raised onto the capsule centre. */
  private seatWorldOf(vehicle: EnterableVehicle): Vec3 {
    const [wx, wy] = this.toWorld(vehicle, [vehicle.seatLocal[0], vehicle.seatLocal[1]]);

    return [wx, wy, vehicle.position[2] + vehicle.seatLocal[2] + SEAT_RAISE];
  }

  /** Settled in the seat + Enter → park (brake to a stop) and open the door to climb back out. */
  private startExit(): void {
    if (!this.active) {
      return;
    }
    this.physics.parkVehicle(this.active.controller); // hold the car still while CJ climbs out
    this.steerAngle = 0;
    this.active.rig.setSteer(0);
    this.phase = 'exitopen';
    this.doorTarget = DOOR_OPEN_ANGLE;
  }

  /** At the doorway → gate the player, start the climb-in clip and slide to the seat. */
  private startGetin(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'getin';
    this.getinElapsed = 0;
    this.getinFrom = this.playerPosition();
    this.seatWorld = this.seatWorldOf(this.active);
    this.storeHold(this.active); // pin the parked car here while the player climbs in
    this.controller.setEnabled(false);
    this.physics.setColliderSensor(this.playerCollider, true); // rider = sensor → can't shove the car
    this.animation.setScripted(CAR_GETIN, { facing: this.active.heading, loop: false });
  }

  /** Door is open → play the climb-out clip and slide from the seat to the doorway. */
  private startGetout(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'exiting';
    this.exitElapsed = 0;
    this.exitFrom = this.playerPosition();
    this.exitTo = this.doorwayWorld(this.active);
    this.storeHold(this.active); // pin the (stopped) car here while the player climbs out
    this.animation.setScripted(CAR_GETOUT, { facing: this.active.heading, loop: false });
  }

  /** Settle into the seat: hold the driving pose and shut the door. */
  private startSeated(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'seated';
    this.engine = 0; // start from idle; drive() ramps the throttle
    this.steerAngle = 0; // start straight; drive() takes over the wheels from here
    this.placePlayer(this.seatWorld);
    this.animation.setScripted(CAR_SIT, { facing: this.active.heading, loop: true });
    this.followTarget(this.active.object); // track the car (smooth) — not the per-frame-teleported rider
    this.aimCamera(this.active.heading); // centre behind the rear once; free to orbit while driving
    this.doorTarget = 0; // pull the door shut from inside
    this.logger.log('enter-vehicle', 'seated');
  }

  /** Door is open → walk the player tight into the open doorway (aligned with the seat). */
  private startStepin(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'stepin';
    this.controller.runPath([this.doorwayWorld(this.active)]);
  }

  /** Snapshot the car's current transform so {@link advanceGetin}/{@link advanceGetout} can pin it. */
  private storeHold(car: EnterableVehicle): void {
    const { position, quaternion } = this.physics.readBody(car.body);
    this.holdPos = [position[0], position[1], position[2]];
    this.holdQuat = [quaternion[0], quaternion[1], quaternion[2], quaternion[3]];
  }

  /** A vehicle-local planar point → world point (Z-up), at the car's height. */
  private toWorld(vehicle: EnterableVehicle, local: [number, number]): Vec3 {
    const cos = Math.cos(vehicle.heading);
    const sin = Math.sin(vehicle.heading);

    return [
      vehicle.position[0] + local[0] * cos - local[1] * sin,
      vehicle.position[1] + local[0] * sin + local[1] * cos,
      vehicle.position[2],
    ];
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Yaw about +Z from a body quaternion `[x, y, z, w]` (the car's heading), via its forward (+Y). */
function headingFromQuat(q: readonly number[]): number {
  const [x, y, z, w] = q;
  const forwardX = 2 * (x * y - w * z);
  const forwardY = 1 - 2 * (x * x + z * z);

  return Math.atan2(-forwardX, forwardY);
}
