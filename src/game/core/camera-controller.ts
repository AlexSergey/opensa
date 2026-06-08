import { Box3, MOUSE, type Object3D, type PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { Config } from '../interfaces/config.interface';

type CameraMode = 'debug' | 'fly' | 'follow';

/** Camera offset direction from its target for one-shot framing (normalised). */
const VIEW_DIR = new Vector3(0.5, 0.6, 1).normalize();
const UP = new Vector3(0, 1, 0);

const LOOK_SENSITIVITY = 0.004; // radians per pixel of mouse movement
const ZOOM_SENSITIVITY = 0.02; // world units per wheel notch
const MIN_FOLLOW_DISTANCE = 4;
const MAX_FOLLOW_DISTANCE = 80;
const DEBUG_HEIGHT = 250; // how high above the district the debug camera sits

const FLY_SPEED = 18; // free-fly translation (world units/second)
const FLY_LOOK_SENSITIVITY = 0.0025; // radians per pixel of mouse movement in fly mode
const MAX_FLY_PITCH = Math.PI / 2 - 0.05; // keep the fly camera off the exact vertical
const FLY_CODES = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp']);

/**
 * Three camera modes:
 * - **follow** (play): orbits the target via plain mouse movement (no button),
 *   clamped to a hemisphere above it (never below the floor); wheel zoom is
 *   optional. Distance / clamps / zoom come from {@link Config.camera}.
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
  private mode: CameraMode = 'follow';
  private polar: number;
  private target: null | Object3D = null;
  private readonly targetPosition = new Vector3();

  constructor(camera: PerspectiveCamera, domElement: HTMLElement, config: Readonly<Config>) {
    this.camera = camera;
    this.domElement = domElement;
    this.config = config;
    this.distance = config.camera.followDistance;
    this.polar = clamp(1, config.camera.followMinPolar, config.camera.followMaxPolar);

    this.controls = new OrbitControls(camera, domElement);
    this.controls.enabled = false; // off in follow mode (custom orbit); on in debug
    this.controls.enableRotate = false;
    this.controls.screenSpacePanning = false; // pan in the world horizontal plane
    this.controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  dispose(): void {
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('wheel', this.onWheel);
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

  /** Set the follow-orbit azimuth (yaw about world up) — e.g. to swing behind the player on car exit. */
  setAzimuth(azimuth: number): void {
    this.azimuth = azimuth;
  }

  /** Switch camera behaviour (follow ⇄ debug ⇄ fly). */
  setMode(mode: CameraMode): void {
    if (mode === this.mode) {
      return;
    }
    this.mode = mode;
    this.controls.enabled = mode === 'debug';
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
  }

  update(delta: number): void {
    if (this.mode === 'debug') {
      this.controls.update();

      return;
    }
    if (this.mode === 'fly') {
      this.flyUpdate(delta);

      return;
    }
    if (!this.target) {
      return;
    }
    this.target.getWorldPosition(this.targetPosition);
    const sinPolar = Math.sin(this.polar);
    this.camera.position.set(
      this.targetPosition.x + this.distance * sinPolar * Math.sin(this.azimuth),
      this.targetPosition.y + this.distance * Math.cos(this.polar),
      this.targetPosition.z + this.distance * sinPolar * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.targetPosition);
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

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.mode === 'fly') {
      this.flyYaw -= event.movementX * FLY_LOOK_SENSITIVITY;
      this.flyPitch = clamp(this.flyPitch - event.movementY * FLY_LOOK_SENSITIVITY, -MAX_FLY_PITCH, MAX_FLY_PITCH);

      return;
    }
    if (this.mode !== 'follow') {
      return;
    }
    this.azimuth -= event.movementX * LOOK_SENSITIVITY;
    this.polar = clamp(
      this.polar - event.movementY * LOOK_SENSITIVITY,
      this.config.camera.followMinPolar,
      this.config.camera.followMaxPolar,
    );
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.mode !== 'follow' || !this.config.camera.followZoom) {
      return;
    }
    event.preventDefault();
    this.distance = clamp(this.distance + event.deltaY * ZOOM_SENSITIVITY, MIN_FOLLOW_DISTANCE, MAX_FOLLOW_DISTANCE);
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
