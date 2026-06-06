import type { CharacterAnimationSystem } from '../character/character-animation.system';
import type { CharacterControllerSystem } from '../character/character-controller.system';
import type { System } from '../core/system';
import type { KeyboardInput } from '../input/keyboard';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld } from '../physics/physics-world';
import type { VehicleDoor } from './vehicle-door';

import { setDoorAngle } from './vehicle-door';

/** A parked car the player can interact with (driver side for now). */
export interface EnterableVehicle {
  doors: VehicleDoor[];
  /** Planar half-extents in vehicle space `[hx, hy]` (for routing around the body). */
  halfExtents: [number, number];
  /** Heading about Z (native). */
  heading: number;
  /** World position (native Z-up). */
  position: Vec3;
  /** Driver seat position in vehicle space `[x, y, z]` (mirrored to the −X driver side). */
  seatLocal: [number, number, number];
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

type Phase = 'approaching' | 'exiting' | 'exitopen' | 'getin' | 'idle' | 'opening' | 'seated' | 'stepin';

/**
 * Drives the full "enter the car" sequence (driver side): from within
 * {@link ENTER_RANGE}, Enter runs the player around to the driver door, opens it,
 * plays the climb-in clip while sliding into the seat, then holds the seated pose
 * and shuts the door. The character controller + locomotion animation are gated
 * while scripted.
 */
export class EnterVehicleSystem implements System {
  readonly name = 'enter-vehicle';

  private active: EnterableVehicle | null = null;
  private readonly aimCamera: (azimuth: number) => void;
  private readonly animation: CharacterAnimationSystem;
  private readonly bodyHandle: number;
  private readonly controller: CharacterControllerSystem;
  private readonly doors = new Map<EnterableVehicle, number>(); // current door angle
  private doorTarget = 0;
  private enterHeld = false;
  private exitElapsed = 0;
  private exitFrom: Vec3 = [0, 0, 0];
  private exitTo: Vec3 = [0, 0, 0];
  private getinElapsed = 0;
  private getinFrom: Vec3 = [0, 0, 0];
  private readonly keyboard: KeyboardInput;
  private phase: Phase = 'idle';
  private readonly physics: PhysicsWorld;
  private readonly playerPosition: () => Vec3;
  private seatWorld: Vec3 = [0, 0, 0];
  private readonly vehicles: EnterableVehicle[] = [];

  constructor(
    keyboard: KeyboardInput,
    playerPosition: () => Vec3,
    controller: CharacterControllerSystem,
    physics: PhysicsWorld,
    bodyHandle: number,
    animation: CharacterAnimationSystem,
    aimCamera: (azimuth: number) => void,
  ) {
    this.keyboard = keyboard;
    this.playerPosition = playerPosition;
    this.controller = controller;
    this.physics = physics;
    this.bodyHandle = bodyHandle;
    this.animation = animation;
    this.aimCamera = aimCamera;
  }

  add(vehicle: EnterableVehicle): void {
    this.vehicles.push(vehicle);
    this.doors.set(vehicle, 0);
  }

  update(delta: number): void {
    const pressed = this.keyboard.isDown(ENTER_KEY);
    const edge = pressed && !this.enterHeld;
    this.enterHeld = pressed;
    if (edge && this.phase === 'idle') {
      this.beginApproach();
    } else if (edge && this.phase === 'seated') {
      this.startExit();
    }

    if (this.phase === 'approaching' && this.controller.arrived) {
      this.phase = 'opening';
      this.doorTarget = DOOR_OPEN_ANGLE;
    }
    if (this.phase === 'getin') {
      this.advanceGetin(delta);
    }
    if (this.phase === 'exiting') {
      this.advanceGetout(delta);
    }
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
  }

  /** Slide the body from the door to the seat over the climb-in clip; then sit. */
  private advanceGetin(delta: number): void {
    this.getinElapsed += delta;
    const t = Math.min(this.getinElapsed / GETIN_DURATION, 1);
    this.physics.teleport(this.bodyHandle, [
      this.getinFrom[0] + (this.seatWorld[0] - this.getinFrom[0]) * t,
      this.getinFrom[1] + (this.seatWorld[1] - this.getinFrom[1]) * t,
      this.getinFrom[2] + (this.seatWorld[2] - this.getinFrom[2]) * t,
    ]);
    if (t >= 1) {
      this.startSeated();
    }
  }

  /** Slide the body from the seat back out to the doorway over the climb-out clip; then finish. */
  private advanceGetout(delta: number): void {
    this.exitElapsed += delta;
    const t = Math.min(this.exitElapsed / GETOUT_DURATION, 1);
    this.physics.teleport(this.bodyHandle, [
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

  /** Lock onto the nearest in-range car and send the player to its driver door. */
  private beginApproach(): void {
    const [px, py] = this.playerPosition();
    let nearest: EnterableVehicle | null = null;
    let nearestDistance = ENTER_RANGE * ENTER_RANGE;
    for (const vehicle of this.vehicles) {
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
    this.controller.runPath(this.driverDoorPath(nearest));
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

  /** Out of the car: restore manual control + locomotion, face away from the car, shut the door. */
  private finishExit(): void {
    const heading = this.active?.heading ?? 0;
    // Yaw facing out of the doorway (vehicle −X side), away from the car body.
    const outward = Math.atan2(Math.cos(heading), -Math.sin(heading));
    this.physics.teleport(this.bodyHandle, this.exitTo);
    this.animation.setScripted(null);
    this.animation.faceTo(outward);
    this.aimCamera(outward); // swing the camera behind the player so forward goes away from the car
    this.controller.setEnabled(true);
    this.doorTarget = 0;
    this.phase = 'idle';
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

  /** Settled in the seat + Enter → open the door to climb back out. */
  private startExit(): void {
    if (!this.active) {
      return;
    }
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
    this.controller.setEnabled(false);
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
    this.animation.setScripted(CAR_GETOUT, { facing: this.active.heading, loop: false });
  }

  /** Settle into the seat: hold the driving pose and shut the door. */
  private startSeated(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'seated';
    this.physics.teleport(this.bodyHandle, this.seatWorld);
    this.animation.setScripted(CAR_SIT, { facing: this.active.heading, loop: true });
    this.aimCamera(this.active.heading); // camera behind the car's rear → forward drives ahead
    this.doorTarget = 0; // pull the door shut from inside
  }

  /** Door is open → walk the player tight into the open doorway (aligned with the seat). */
  private startStepin(): void {
    if (!this.active) {
      return;
    }
    this.phase = 'stepin';
    this.controller.runPath([this.doorwayWorld(this.active)]);
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
