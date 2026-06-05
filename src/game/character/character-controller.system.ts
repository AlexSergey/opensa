import { query } from 'bitecs';
import { type PerspectiveCamera, Vector3 } from 'three';

import type { System } from '../core/system';
import type { EcsWorld } from '../ecs/world';
import type { KeyboardInput } from '../input/keyboard';
import type { Config } from '../interfaces/config.interface';
import type { PhysicsWorld } from '../physics/physics-world';

import { PlayerControlled, RigidBody } from '../ecs/components';

const MOVE_SPEED = 6;
const JUMP_SPEED = 6;

/**
 * Drives player-controlled bodies from the keyboard while the game is playing.
 * Movement is **camera-relative** (W goes where the camera looks): the camera's
 * ground-plane direction is converted from scene Y-up into the GTA Z-up world.
 * Steering and jumping only apply while grounded ("once you touch the ground you
 * can move it"); in the air the body keeps its momentum and only gravity acts.
 */
export class CharacterControllerSystem implements System {
  readonly name = 'character-controller';

  private readonly camera: PerspectiveCamera;
  private readonly config: Readonly<Config>;
  private readonly forward = new Vector3();
  private readonly halfHeight: number;
  private readonly keyboard: KeyboardInput;
  private readonly physics: PhysicsWorld;
  private readonly right = new Vector3();
  private readonly world: EcsWorld;

  constructor(
    world: EcsWorld,
    physics: PhysicsWorld,
    keyboard: KeyboardInput,
    config: Readonly<Config>,
    halfHeight: number,
    camera: PerspectiveCamera,
  ) {
    this.world = world;
    this.physics = physics;
    this.keyboard = keyboard;
    this.config = config;
    this.halfHeight = halfHeight;
    this.camera = camera;
  }

  fixedUpdate(): void {
    if (this.config.gameState !== 'play') {
      return;
    }
    const { controls } = this.config;
    const move = this.cameraRelativeMove(
      this.axis(controls.forward, controls.back),
      this.axis(controls.right, controls.left),
    );
    const jump = this.keyboard.isDown(controls.jump);

    for (const eid of query(this.world, [PlayerControlled, RigidBody])) {
      const handle = RigidBody.handle[eid];
      if (!this.physics.isGrounded(handle, this.halfHeight)) {
        continue; // keep air momentum; steer only on the ground
      }
      const vz = jump ? JUMP_SPEED : this.physics.getLinvel(handle)[2];
      this.physics.setLinvel(handle, [move.x, move.y, vz]);
    }
  }

  private axis(positive: string, negative: string): number {
    return (this.keyboard.isDown(positive) ? 1 : 0) - (this.keyboard.isDown(negative) ? 1 : 0);
  }

  /** Planar velocity (Z-up) for a forward/right input, relative to the camera. */
  private cameraRelativeMove(forwardInput: number, rightInput: number): { x: number; y: number } {
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
      x = (x / length) * MOVE_SPEED;
      y = (y / length) * MOVE_SPEED;
    }

    return { x, y };
  }
}
