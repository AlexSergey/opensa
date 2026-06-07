import type { Object3D } from 'three';

import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { AnimationController } from './animation-controller';

import { Velocity } from '../ecs/components';

/** Above this planar speed the body turns to face its movement direction. */
const FACE_MIN_SPEED = 0.5;
/** Crossfade between animation states. */
const FADE = 0.12;
/** Max body turn rate (rad/s) toward the movement direction — a visible turn, not a snap. */
const TURN_SPEED = 12;
/** Ground speed (units/s) the walk/run clips are authored at (root motion in ped.ifp); used to
 *  scale playback to the actual speed so the feet don't slide. */
const AUTHORED_WALK_SPEED = 1.52;
const AUTHORED_RUN_SPEED = 4.31;
const MIN_PLAYBACK = 0.6;
const MAX_PLAYBACK = 2.2;
/** Procedural locomotion bounce (extra body bob on top of the clip). */
const BOB_AMPLITUDE = 0.007; // peak vertical offset (units); reached by walk speed and held (run doesn't amplify)
const BOB_FREQUENCY = 7; // bob phase radians per unit of distance (≈2 bobs per stride → footfall-synced)

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
 * Picks the player's animation each frame from its ECS {@link Velocity} (grounded
 * + planar speed + vertical velocity) and crossfades the {@link AnimationController},
 * then turns the body to face its movement direction. The jump plays as a
 * sequence — `launch` (rising) → `glide` (falling, looped) → `land` (on touch) —
 * via a small state machine. Frozen while paused.
 */
export class CharacterAnimationSystem implements System {
  readonly name = 'character-animation';

  private readonly baseModelZ: number;
  private bobPhase = 0;
  private readonly character: Object3D;
  private readonly config: Readonly<Config>;
  private readonly controller: AnimationController;
  /** Current facing yaw about GTA +Z; default faces away from the camera's start side. */
  private facing = Math.PI;
  /** Below this planar speed → idle; at/above {@link runMin} → run; between → walk. */
  private readonly idleMax: number;
  private readonly landDuration: number;
  private readonly launchDuration: number;
  /** Inner model carrying the procedural locomotion bob (under the wrapper). */
  private readonly model: Object3D | undefined;
  private readonly playerEid: number;
  private readonly runMin: number;
  /** When set, a one-shot/looped clip (e.g. a car entry/sit) overrides locomotion. */
  private scriptedClip: null | string = null;
  private scriptedFacing: null | number = null;
  private scriptedLoop = true;
  /** Full body orientation `[x, y, z, w]` while scripted (e.g. tilt/flip with a car); overrides facing. */
  private scriptedOrientation: null | readonly [number, number, number, number] = null;
  private state: LocoState = 'ground';
  private stateTime = 0;
  /** Facing the body is turning toward (movement direction); `facing` eases to it. */
  private targetFacing = Math.PI;

  constructor(controller: AnimationController, playerEid: number, character: Object3D, config: Readonly<Config>) {
    this.controller = controller;
    this.playerEid = playerEid;
    this.character = character;
    this.config = config;
    // The inner model (under the render-synced wrapper) carries the procedural bob.
    this.model = character.children[0];
    this.baseModelZ = this.model?.position.z ?? 0;
    this.launchDuration = controller.duration(CLIPS.launch);
    this.landDuration = controller.duration(CLIPS.land);
    // Thresholds follow the configured speeds: idle below ~⅓ walk, run past the walk/run midpoint.
    this.idleMax = config.movement.walkSpeed * 0.35;
    this.runMin = (config.movement.walkSpeed + config.movement.runSpeed) / 2;
  }

  /** Snap the locomotion facing (yaw about +Z) — e.g. so the player faces away from a car on exit. */
  faceTo(yaw: number): void {
    this.facing = yaw;
    this.targetFacing = yaw;
  }

  /** Current locomotion facing (yaw about GTA +Z) — e.g. to spawn something in front of the player. */
  getFacing(): number {
    return this.facing;
  }

  /**
   * Override locomotion with a scripted clip (car entry/sit, …) and optional held
   * facing (yaw about +Z). Pass `null` to return to keyboard-driven locomotion.
   */
  setScripted(
    clip: null | string,
    options: { facing?: number; loop?: boolean; orientation?: readonly [number, number, number, number] } = {},
  ): void {
    this.scriptedClip = clip;
    this.scriptedLoop = options.loop ?? true;
    this.scriptedFacing = options.facing ?? null;
    this.scriptedOrientation = options.orientation ?? null;
  }

  update(delta: number): void {
    if (this.config.gameState !== 'play') {
      return; // freeze the pose while paused
    }

    if (this.scriptedClip) {
      this.playScripted(delta);

      return;
    }

    const eid = this.playerEid;
    const vx = Velocity.x[eid];
    const vy = Velocity.y[eid];
    const vz = Velocity.z[eid];
    const speed = Math.hypot(vx, vy);
    const grounded = Velocity.grounded[eid] === 1;
    this.stateTime += delta;
    if (speed > FACE_MIN_SPEED) {
      this.targetFacing = Math.atan2(-vx, vy);
    }
    // Ease the body toward the movement direction (a visible turn, not an instant snap).
    this.facing = approachAngle(this.facing, this.targetFacing, TURN_SPEED * delta);

    this.advance(grounded, vz);
    const looping = this.state === 'ground' || this.state === 'glide';
    this.controller.play(this.state === 'ground' ? this.groundClip(speed) : CLIPS[this.state], FADE, looping);
    // Scale walk/run playback to the actual speed so the feet don't slide.
    this.controller.setSpeed(this.state === 'ground' ? playbackScale(speed, this.idleMax, this.runMin) : 1);

    // Apply every frame: render-sync overwrites the wrapper's rotation from the body.
    this.character.rotation.z = this.facing;
    this.controller.update(delta);
    this.applyBounce(speed, grounded, delta);
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

  /** Add a procedural vertical body bounce on top of the clip, scaled to ground speed. */
  private applyBounce(speed: number, grounded: boolean, delta: number): void {
    if (!this.model) {
      return;
    }
    const moving = grounded && speed > this.idleMax;
    if (moving) {
      this.bobPhase += speed * BOB_FREQUENCY * delta;
    }
    // Ramp the bob up to walk speed, then hold it — running keeps the same gentle bounce.
    const amplitude = moving ? Math.min(speed / this.config.movement.walkSpeed, 1) * BOB_AMPLITUDE : 0;
    this.model.position.z = this.baseModelZ + Math.sin(this.bobPhase) * amplitude;
  }

  private groundClip(speed: number): string {
    if (speed < this.idleMax) {
      return CLIPS.idle;
    }

    return speed < this.runMin ? CLIPS.walk : CLIPS.run;
  }

  /** Play the scripted clip (held facing, no locomotion bob) instead of walk/run/idle. */
  private playScripted(delta: number): void {
    if (this.scriptedOrientation) {
      const [x, y, z, w] = this.scriptedOrientation;
      this.character.quaternion.set(x, y, z, w); // full tilt/flip with the car
    } else if (this.scriptedFacing !== null) {
      this.character.rotation.z = this.scriptedFacing;
    }
    this.controller.setSpeed(1);
    this.controller.play(this.scriptedClip ?? CLIPS.idle, FADE, this.scriptedLoop);
    this.controller.update(delta);
    if (this.model) {
      this.model.position.z = this.baseModelZ;
    }
  }
}

/** Rotate `current` toward `target` (radians) by at most `maxStep`, via the shortest arc. */
function approachAngle(current: number, target: number, maxStep: number): number {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  if (Math.abs(diff) <= maxStep) {
    return target;
  }

  return current + Math.sign(diff) * maxStep;
}

/** Clip playback rate matching the actual ground speed to the clip's authored speed (no foot slide). */
function playbackScale(speed: number, idleMax: number, runMin: number): number {
  if (speed < idleMax) {
    return 1; // idle
  }
  const authored = speed < runMin ? AUTHORED_WALK_SPEED : AUTHORED_RUN_SPEED;

  return Math.min(MAX_PLAYBACK, Math.max(MIN_PLAYBACK, speed / authored));
}
