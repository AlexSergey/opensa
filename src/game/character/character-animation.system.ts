import type { Object3D } from 'three';

import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { PhysicsWorld } from '../physics/physics-world';
import type { AnimationController } from './animation-controller';

/** Above this planar speed the body turns to face its movement direction. */
const FACE_MIN_SPEED = 0.5;
/** Crossfade between animation states. */
const FADE = 0.12;

/** Clip names (lowercased, matching `ped.ifp`) for each state. */
const CLIPS = {
  glide: 'jump_glide',
  idle: 'idle_stance',
  land: 'jump_land',
  launch: 'jump_launch',
  run: 'run_civi',
  walk: 'walk_civi',
} as const;

/** ground = idle/walk/run by speed; the rest is the jump sequence launch → glide → land. */
type LocoState = 'glide' | 'ground' | 'land' | 'launch';

/**
 * Picks the player's animation each frame from its physics state (grounded +
 * planar speed + vertical velocity) and crossfades the {@link AnimationController},
 * then turns the body to face its movement direction. The jump plays as a
 * sequence — `launch` (rising) → `glide` (falling, looped) → `land` (on touch) —
 * via a small state machine. Frozen while paused.
 */
export class CharacterAnimationSystem implements System {
  readonly name = 'character-animation';

  private readonly body: number;
  private readonly character: Object3D;
  private readonly config: Readonly<Config>;
  private readonly controller: AnimationController;
  /** Current facing yaw about GTA +Z; default faces away from the camera's start side. */
  private facing = Math.PI;
  private readonly halfHeight: number;
  /** Below this planar speed → idle; at/above {@link runMin} → run; between → walk. */
  private readonly idleMax: number;
  private readonly landDuration: number;
  private readonly launchDuration: number;
  private readonly physics: PhysicsWorld;
  private readonly runMin: number;
  private state: LocoState = 'ground';
  private stateTime = 0;

  constructor(
    controller: AnimationController,
    physics: PhysicsWorld,
    body: number,
    halfHeight: number,
    character: Object3D,
    config: Readonly<Config>,
  ) {
    this.controller = controller;
    this.physics = physics;
    this.body = body;
    this.halfHeight = halfHeight;
    this.character = character;
    this.config = config;
    this.launchDuration = controller.duration(CLIPS.launch);
    this.landDuration = controller.duration(CLIPS.land);
    // Thresholds follow the configured speeds: idle below ~⅓ walk, run past the walk/run midpoint.
    this.idleMax = config.movement.walkSpeed * 0.35;
    this.runMin = (config.movement.walkSpeed + config.movement.runSpeed) / 2;
  }

  update(delta: number): void {
    if (this.config.gameState !== 'play') {
      return; // freeze the pose while paused
    }

    const [vx, vy, vz] = this.physics.getLinvel(this.body);
    const speed = Math.hypot(vx, vy);
    const grounded = this.physics.isGrounded(this.body, this.halfHeight);
    this.stateTime += delta;
    if (speed > FACE_MIN_SPEED) {
      this.facing = Math.atan2(-vx, vy);
    }

    this.advance(grounded, vz);
    const looping = this.state === 'ground' || this.state === 'glide';
    this.controller.play(this.state === 'ground' ? this.groundClip(speed) : CLIPS[this.state], FADE, looping);

    // Apply every frame: render-sync overwrites the wrapper's rotation from the body.
    this.character.rotation.z = this.facing;
    this.controller.update(delta);
  }

  /** Advance the jump state machine; resets the state timer on a transition. */
  private advance(grounded: boolean, vz: number): void {
    const previous = this.state;
    switch (this.state) {
      case 'glide':
        if (grounded) {
          this.state = 'land';
        }
        break;
      case 'ground':
        if (!grounded) {
          this.state = 'launch';
        }
        break;
      case 'land':
        if (!grounded) {
          this.state = 'launch';
        } else if (this.stateTime >= this.landDuration) {
          this.state = 'ground';
        }
        break;
      case 'launch':
        if (grounded) {
          this.state = 'land';
        } else if (this.stateTime >= this.launchDuration || vz < 0) {
          this.state = 'glide';
        }
        break;
    }
    if (this.state !== previous) {
      this.stateTime = 0;
    }
  }

  private groundClip(speed: number): string {
    if (speed < this.idleMax) {
      return CLIPS.idle;
    }

    return speed < this.runMin ? CLIPS.walk : CLIPS.run;
  }
}
