import { query } from 'bitecs';
import { type PerspectiveCamera, Vector3 } from 'three';

import type { System } from '../core/system';
import type { EcsWorld } from '../ecs/world';
import type { KeyboardInput } from '../input/keyboard';
import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { CharacterController, PhysicsWorld } from '../physics/physics-world';

import { PlayerControlled, RigidBody, Transform, Velocity } from '../ecs/components';

/** Gravity integrated into the kinematic body's vertical velocity (Z-up). */
const GRAVITY = -9.81;

/** Planar distance (m) at which a scripted {@link CharacterControllerSystem.runTo} target is reached. */
const ARRIVE_DISTANCE = 0.6;

/**
 * Drives the player's **kinematic capsule** from the keyboard while playing.
 * Movement is **camera-relative** (W goes where the camera looks). Each fixed
 * step it builds a desired velocity — horizontal **accelerated** toward the input
 * target (ramp-up, turn momentum, reduced air control), vertical from gravity +
 * jump — asks the {@link CharacterController} for the collision-corrected move
 * (slides along obstacles, climbs steps, snaps to ground), and writes the result
 * + grounded state to the ECS {@link Velocity}.
 */
export class CharacterControllerSystem implements System {
  readonly name = 'character-controller';

  /** True once the player has reached a {@link runTo} target (until the next `runTo`). */
  get arrived(): boolean {
    return this.autoArrived;
  }
  private autoArrived = false;
  private autoIndex = 0;
  private autoPath: Vec3[] = [];
  private readonly camera: PerspectiveCamera;
  private readonly config: Readonly<Config>;
  private readonly controller: CharacterController;
  private enabled = true;
  private readonly forward = new Vector3();
  private readonly keyboard: KeyboardInput;
  private readonly physics: PhysicsWorld;
  private readonly right = new Vector3();

  private readonly world: EcsWorld;

  constructor(
    world: EcsWorld,
    physics: PhysicsWorld,
    keyboard: KeyboardInput,
    config: Readonly<Config>,
    controller: CharacterController,
    camera: PerspectiveCamera,
  ) {
    this.world = world;
    this.physics = physics;
    this.keyboard = keyboard;
    this.config = config;
    this.controller = controller;
    this.camera = camera;
  }

  fixedUpdate(step: number): void {
    if (!this.enabled || this.config.gameState !== 'play') {
      return; // gated (e.g. while the player is scripted into a car)
    }
    const { movement } = this.config;
    const players = query(this.world, [PlayerControlled, RigidBody, Velocity]);
    const { jump, target } = this.desiredMove(players);
    const moving = target.x !== 0 || target.y !== 0;

    for (const eid of players) {
      const grounded = Velocity.grounded[eid] === 1;
      // Horizontal: accelerate toward the target (decelerate toward rest with no input),
      // at a reduced rate in the air → ramp-up, turn momentum, momentum into jumps.
      const rate = (moving ? movement.accel : movement.deceleration) * (grounded ? 1 : movement.airControl) * step;
      approach(eid, target.x, target.y, rate);
      // Vertical: reset on the ground (jump impulse if requested), then integrate gravity.
      let vz = grounded ? (jump ? movement.jumpSpeed : 0) : Velocity.z[eid];
      vz += GRAVITY * step;

      const move = this.physics.moveCharacter(this.controller, RigidBody.handle[eid], RigidBody.collider[eid], [
        Velocity.x[eid] * step,
        Velocity.y[eid] * step,
        vz * step,
      ]);
      Velocity.grounded[eid] = move.grounded ? 1 : 0;
      Velocity.z[eid] = move.grounded && vz < 0 ? 0 : vz; // landed → stop accumulating fall speed
    }
  }

  /**
   * Drive the player along a world-space path (Z-up), ignoring the keyboard until
   * the last point is reached. Pass `[]` to restore manual control.
   */
  runPath(points: readonly Vec3[]): void {
    this.autoPath = [...points];
    this.autoIndex = 0;
    this.autoArrived = points.length === 0;
  }

  /** Enable/disable manual + scripted control (e.g. while the player is seated in a car). */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.autoPath = [];
      // Stop the body so stale velocity doesn't drive facing/locomotion when control returns.
      for (const eid of query(this.world, [PlayerControlled, Velocity])) {
        Velocity.x[eid] = 0;
        Velocity.y[eid] = 0;
        Velocity.z[eid] = 0;
      }
    }
  }

  private axis(positive: string, negative: string): number {
    return (this.keyboard.isDown(positive) ? 1 : 0) - (this.keyboard.isDown(negative) ? 1 : 0);
  }

  /** Planar velocity (Z-up) for a forward/right input at `speed`, relative to the camera. */
  private cameraRelativeMove(forwardInput: number, rightInput: number, speed: number): { x: number; y: number } {
    // Camera look direction (scene Y-up) projected to the ground, converted to
    // GTA Z-up: (x, y, z) → (x, −z, 0). Right = forward × up(0,0,1).
    this.camera.getWorldDirection(this.forward);
    this.forward.set(this.forward.x, -this.forward.z, 0);
    if (this.forward.lengthSq() < 1e-6) {
      this.forward.set(0, 1, 0); // looking straight down/up — pick a stable axis
    }
    this.forward.normalize();
    this.right.set(this.forward.y, -this.forward.x, 0);

    let x = this.forward.x * forwardInput + this.right.x * rightInput;
    let y = this.forward.y * forwardInput + this.right.y * rightInput;
    const length = Math.hypot(x, y);
    if (length > 0) {
      x = (x / length) * speed;
      y = (y / length) * speed;
    }

    return { x, y };
  }

  /** Desired planar velocity + jump for this step — scripted auto-run if active, else keyboard. */
  private desiredMove(players: ArrayLike<number>): { jump: boolean; target: { x: number; y: number } } {
    const { controls, movement } = this.config;
    if (this.autoIndex < this.autoPath.length && players.length > 0) {
      // Scripted auto-run (e.g. around to a car door) — ignore the keyboard until arrival.
      return { jump: false, target: this.moveToward(players[0], movement.runSpeed) };
    }
    const running = Boolean(controls.run) && this.keyboard.isDown(controls.run as string);
    const target = this.cameraRelativeMove(
      this.axis(controls.forward, controls.back),
      this.axis(controls.right, controls.left),
      running ? movement.runSpeed : movement.walkSpeed,
    );

    return { jump: this.keyboard.isDown(controls.jump), target };
  }

  /** Planar velocity toward the current path waypoint; advances/flags arrival as points are reached. */
  private moveToward(eid: number, speed: number): { x: number; y: number } {
    const target = this.autoPath[this.autoIndex];
    const dx = target[0] - Transform.x[eid];
    const dy = target[1] - Transform.y[eid];
    const distance = Math.hypot(dx, dy);
    if (distance < ARRIVE_DISTANCE) {
      this.autoIndex += 1;
      if (this.autoIndex >= this.autoPath.length) {
        this.autoPath = [];
        this.autoArrived = true;

        return { x: 0, y: 0 };
      }

      return this.moveToward(eid, speed); // head to the next waypoint
    }

    return { x: (dx / distance) * speed, y: (dy / distance) * speed };
  }
}

/** Move an entity's horizontal velocity toward (tx, ty) by at most `maxDelta` (planar). */
function approach(eid: number, tx: number, ty: number, maxDelta: number): void {
  const dx = tx - Velocity.x[eid];
  const dy = ty - Velocity.y[eid];
  const distance = Math.hypot(dx, dy);
  if (distance <= maxDelta || distance === 0) {
    Velocity.x[eid] = tx;
    Velocity.y[eid] = ty;

    return;
  }
  Velocity.x[eid] += (dx / distance) * maxDelta;
  Velocity.y[eid] += (dy / distance) * maxDelta;
}
