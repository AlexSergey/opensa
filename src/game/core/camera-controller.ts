import { Box3, MOUSE, type Object3D, type PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { InputState } from '../input';
import type { Config } from '../interfaces/config.interface';

type CameraMode = 'debug' | 'fly' | 'follow';

/** Camera offset direction from its target for one-shot framing (normalised). */
const VIEW_DIR = new Vector3(0.5, 0.6, 1).normalize();
const UP = new Vector3(0, 1, 0);

const LOOK_SENSITIVITY = 0.004; // radians per pixel of mouse movement
const ZOOM_SENSITIVITY = 0.02; // world units per wheel notch
const MOVE_THRESHOLD = 0.5; // world units/second the player must be moving for auto-follow to consider heading
const TURN_THRESHOLD = 0.9; // radians/second of heading change before the camera swings behind (else hold the angle)
const MANUAL_GRACE_MS = 250; // after a mouse look, hold off auto-follow this long (manual framing wins)
const SETTLE_EPSILON = 0.03; // radians from "directly behind" at which an engaged follow stops easing
const DEBUG_HEIGHT = 250; // how high above the district the debug camera sits

const FLY_SPEED = 18; // free-fly translation (world units/second)
const FLY_LOOK_SENSITIVITY = 0.0025; // radians per pixel of mouse movement in fly mode
const MAX_FLY_PITCH = Math.PI / 2 - 0.05; // keep the fly camera off the exact vertical
const FLY_CODES = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']);

/**
 * Three camera modes:
 * - **follow** (play): trails the target from behind + above. **Plain mouse movement orbits** it (no button),
 *   clamped to a hemisphere above. When the player **changes direction** (turns / starts reversing) it
 *   **auto-swings behind** their heading — but going straight keeps whatever angle the player set, and an active
 *   mouse look suppresses it (the player wins). Wheel zoom (optional) is clamped to the configured range. All
 *   tuning (distance / angle / responsiveness / clamps / zoom range) is {@link Config.camera}.
 * - **debug**: detached, top-down over the district; drag (held button) pans X/Y,
 *   wheel dollies down. Built on OrbitControls.
 * - **fly**: detached free-fly for screenshots — arrow keys translate along the
 *   view direction, mouse looks around. Affects nothing but the camera.
 */
export class CameraController {
  private azimuth = Math.PI;
  private readonly camera: PerspectiveCamera;
  private readonly config: Readonly<Config>;
  private readonly controls: OrbitControls;
  private distance: number;
  private readonly domElement: HTMLElement;
  private readonly flyKeys = new Set<string>();
  private flyPitch = 0;
  private flyYaw = 0;
  private following = false; // a direction change engaged auto-follow; eases until settled behind, then clears
  private hasHeading = false;
  private hasPrevTarget = false;
  private readonly input: InputState;
  private lastManualMs = 0; // performance.now() of the last mouse look — suppresses auto-follow for a grace window
  private mode: CameraMode = 'follow';
  private polar: number;
  private prevHeading = 0; // last movement heading (radians) — to detect a direction change
  private readonly prevTarget = new Vector3();
  private target: null | Object3D = null;
  private readonly targetPosition = new Vector3();

  constructor(camera: PerspectiveCamera, domElement: HTMLElement, config: Readonly<Config>, input: InputState) {
    this.camera = camera;
    this.domElement = domElement;
    this.config = config;
    this.input = input;
    this.distance = config.camera.followDistance;
    this.polar = clamp(config.camera.followPolar, config.camera.followMinPolar, config.camera.followMaxPolar);

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enabled = false; // off in follow mode (custom orbit); on in debug
    this.controls.enableRotate = true; // RIGHT-drag orbits in debug; gated by `enabled` (off in follow/fly)
    this.controls.screenSpacePanning = false; // pan in the world horizontal plane
    // Debug map inspector: LEFT pans, RIGHT orbits, wheel dollies.
    this.controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    this.controls.minPolarAngle = 0; // straight down …
    this.controls.maxPolarAngle = Math.PI / 2; // … to the horizon (don't orbit under the ground)

    // Look/zoom come from the InputState (a PointerLookSource on desktop; a touch look-pad on mobile — plan
    // 055). Fly-mode arrow-key translation stays a local dev-tool binding.
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.controls.dispose();
  }

  /** Point the camera at a world target from a fixed distance (one-shot framing). */
  focus(target: Vector3, distance: number): void {
    this.camera.position.copy(target).addScaledVector(VIEW_DIR, distance);
    this.camera.near = Math.max(0.5, distance / 1000);
    this.camera.far = Math.max(8000, distance * 50);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);
    this.controls.target.copy(target);
  }

  /** Frame the bounding box of the given objects (region framing, used in debug). */
  frameObjects(objects: Object3D[]): void {
    const box = new Box3();
    for (const object of objects) {
      object.updateMatrixWorld(true);
      box.expandByObject(object);
    }
    if (box.isEmpty()) {
      return;
    }
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.25;
    this.camera.position.copy(center).addScaledVector(VIEW_DIR, distance);
    this.camera.near = Math.max(0.5, distance / 1000);
    this.camera.far = Math.max(8000, distance * 50);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.controls.target.copy(center);
  }

  /** Current live follow distance (wheel zoom included) — for the debug "current" readout. */
  getDistance(): number {
    return this.distance;
  }

  /** Set the follow-orbit azimuth (yaw about world up) — e.g. to swing behind the player on car exit. */
  setAzimuth(azimuth: number): void {
    this.azimuth = azimuth;
  }

  /** Set the follow distance (debug tuning); clamped to the configured zoom range. */
  setDistance(distance: number): void {
    this.distance = clamp(distance, this.config.camera.followZoomMin, this.config.camera.followZoomMax);
  }

  /** Switch camera behaviour (follow ⇄ debug ⇄ fly). */
  setMode(mode: CameraMode): void {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    this.controls.enabled = mode === 'debug';
    this.following = false;
    this.hasHeading = false;
    this.hasPrevTarget = false; // forget the last position so re-entering follow doesn't jump
    if (mode === 'debug') {
      this.enterDebug();
    } else if (mode === 'fly') {
      this.enterFly();
    } else {
      this.flyKeys.clear();
    }
  }

  setTarget(object: null | Object3D): void {
    this.target = object;
    this.following = false;
    this.hasHeading = false;
    this.hasPrevTarget = false;
  }

  /** Snap the debug map camera back to straight-down over its current pan centre (undo any RIGHT-drag orbit). */
  topDownDebugView(): void {
    if (this.mode !== 'debug') {
      return;
    }
    const target = this.controls.target;
    this.camera.position.set(target.x, target.y + DEBUG_HEIGHT, target.z + 0.001);
    this.controls.update();
  }

  update(delta: number): void {
    // Look/zoom deltas are consumed (cleared) every frame regardless of mode (debug discards them).
    const look = this.input.consumeLook();
    const zoom = this.input.consumeZoom();
    if (this.mode === 'debug') {
      this.controls.update();

      return;
    }
    if (this.mode === 'fly') {
      this.flyYaw -= look.x * FLY_LOOK_SENSITIVITY;
      this.flyPitch = clamp(this.flyPitch - look.y * FLY_LOOK_SENSITIVITY, -MAX_FLY_PITCH, MAX_FLY_PITCH);
      this.flyUpdate(delta);

      return;
    }
    // Follow: plain look orbits (no button), suppressing auto-follow for a grace window; wheel zooms.
    if (look.x !== 0 || look.y !== 0) {
      this.lastManualMs = performance.now();
      this.azimuth -= look.x * LOOK_SENSITIVITY;
      this.polar = clamp(
        this.polar - look.y * LOOK_SENSITIVITY,
        this.config.camera.followMinPolar,
        this.config.camera.followMaxPolar,
      );
    }
    if (zoom !== 0 && this.config.camera.followZoom) {
      const { followZoomMax, followZoomMin } = this.config.camera;
      this.distance = clamp(this.distance + zoom * ZOOM_SENSITIVITY, followZoomMin, followZoomMax);
    }
    if (!this.target) {
      return;
    }
    this.target.getWorldPosition(this.targetPosition);
    this.autoFollow(delta); // swing behind the player when they change direction (unless they're steering the camera)
    const sinPolar = Math.sin(this.polar);
    const lookY = this.targetPosition.y + this.config.camera.followHeight; // orbit + look at a raised point, not the feet
    this.camera.position.set(
      this.targetPosition.x + this.distance * sinPolar * Math.sin(this.azimuth),
      lookY + this.distance * Math.cos(this.polar),
      this.targetPosition.z + this.distance * sinPolar * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.targetPosition.x, lookY, this.targetPosition.z);
    this.prevTarget.copy(this.targetPosition);
    this.hasPrevTarget = true;
  }

  /**
   * Swing the orbit **behind the player's movement direction — but only while their heading is changing**
   * (a turn, or starting to reverse). Walking/driving straight leaves the azimuth alone, so a camera angle the
   * player set with the mouse is kept. A recent mouse look ({@link MANUAL_GRACE_MS}) also suppresses it, so
   * "turn while steering the camera" obeys the player. Pitch is never auto-touched (manual only). Easing rate is
   * `followLerp`.
   */
  private autoFollow(delta: number): void {
    if (!this.hasPrevTarget) {
      return;
    }
    const moveX = this.targetPosition.x - this.prevTarget.x;
    const moveZ = this.targetPosition.z - this.prevTarget.z;
    const step = Math.max(delta, 1e-4);
    if (Math.hypot(moveX, moveZ) / step < MOVE_THRESHOLD) {
      return; // standing still: keep the current heading reference and angle
    }
    const heading = Math.atan2(moveX, moveZ);
    const turning = this.hasHeading && Math.abs(shortestAngle(heading - this.prevHeading)) / step > TURN_THRESHOLD;
    this.prevHeading = heading;
    this.hasHeading = true;
    // Steering the camera wins; a detected turn engages a follow that runs until the camera has settled behind
    // (so even a one-frame reverse fully re-centres, while going straight just holds the angle).
    if (performance.now() - this.lastManualMs < MANUAL_GRACE_MS) {
      this.following = false;

      return;
    }
    if (turning) {
      this.following = true;
    }
    if (!this.following) {
      return;
    }
    const diff = shortestAngle(Math.atan2(-moveX, -moveZ) - this.azimuth); // toward behind the movement direction
    this.azimuth += diff * Math.min(1, this.config.camera.followLerp * delta);
    if (Math.abs(diff) < SETTLE_EPSILON) {
      this.following = false; // settled directly behind → stop until the next direction change
    }
  }

  /** Detach over the district: top-down, panable, looking down at the last target. */
  private enterDebug(): void {
    if (this.target) {
      this.target.getWorldPosition(this.targetPosition);
    }
    this.controls.target.copy(this.targetPosition);
    this.camera.position.set(
      this.targetPosition.x,
      this.targetPosition.y + DEBUG_HEIGHT,
      this.targetPosition.z + 0.001,
    );
    this.controls.enabled = true;
    this.controls.update();
  }

  /** Seed the free-fly yaw/pitch from where the camera currently looks (no jump on entry). */
  private enterFly(): void {
    this.flyKeys.clear();
    const dir = this.camera.getWorldDirection(new Vector3());
    this.flyPitch = Math.asin(clamp(dir.y, -1, 1));
    this.flyYaw = Math.atan2(dir.x, dir.z);
  }

  /** Free-fly: translate along the view direction by the held arrow keys, then look along it. */
  private flyUpdate(delta: number): void {
    const cosPitch = Math.cos(this.flyPitch);
    const forward = new Vector3(
      Math.sin(this.flyYaw) * cosPitch,
      Math.sin(this.flyPitch),
      Math.cos(this.flyYaw) * cosPitch,
    );
    const right = new Vector3().crossVectors(forward, UP).normalize(); // camera-right (strafe +)
    const step = FLY_SPEED * delta;
    if (this.flyKeys.has('ArrowUp')) {
      this.camera.position.addScaledVector(forward, step);
    }
    if (this.flyKeys.has('ArrowDown')) {
      this.camera.position.addScaledVector(forward, -step);
    }
    if (this.flyKeys.has('ArrowRight')) {
      this.camera.position.addScaledVector(right, step);
    }
    if (this.flyKeys.has('ArrowLeft')) {
      this.camera.position.addScaledVector(right, -step);
    }
    this.camera.lookAt(
      this.camera.position.x + forward.x,
      this.camera.position.y + forward.y,
      this.camera.position.z + forward.z,
    );
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.mode !== 'fly' || !FLY_CODES.has(event.code)) {
      return;
    }
    event.preventDefault();
    this.flyKeys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.flyKeys.delete(event.code);
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Wrap an angle difference to the shortest signed rotation in (−π, π]. */
function shortestAngle(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}
