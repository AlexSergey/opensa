import { query } from 'bitecs';
import { type PerspectiveCamera, Vector3 } from 'three';

import type { System } from '../core/system';
import type { EcsWorld } from '../ecs/world';
import type { KeyboardInput } from '../input/keyboard';
import type { Config } from '../interfaces/config.interface';
import type { CharacterController, PhysicsWorld } from '../physics/physics-world';

import { PlayerControlled, RigidBody, Velocity } from '../ecs/components';

/** Gravity integrated into the kinematic body's vertical velocity (Z-up). */
const GRAVITY = -9.81;

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

  private readonly camera: PerspectiveCamera;
  private readonly config: Readonly<Config>;
  private readonly controller: CharacterController;
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
    if (this.config.gameState !== 'play') {
      return;
    }
    const { controls, movement } = this.config;
    const running = Boolean(controls.run) && this.keyboard.isDown(controls.run as string);
    const target = this.cameraRelativeMove(
      this.axis(controls.forward, controls.back),
      this.axis(controls.right, controls.left),
      running ? movement.runSpeed : movement.walkSpeed,
    );
    const jump = this.keyboard.isDown(controls.jump);

    const moving = target.x !== 0 || target.y !== 0;

    for (const eid of query(this.world, [PlayerControlled, RigidBody, Velocity])) {
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
