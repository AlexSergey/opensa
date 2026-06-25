import {
  AdditiveBlending,
  type Camera,
  CanvasTexture,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';

import type { System } from '../core/system';
import type { HeadlightConfig } from '../interfaces/config.interface';
import type { EnterableVehicle, EnterVehicleSystem } from './enter-vehicle.system';

/** Glow / corona colours by light type (rendered colour, not the marker colour): warm-white head, red tail. */
const HEAD_COLOR = 0xfff2d0;
const TAIL_COLOR = 0xff1808;
/** Lamp-glass emissive strengths (× config `intensity`). Modest so bloom gives a tight halo, not a wash. */
const HEAD_EMISSIVE = 1.2;
const TAIL_RUN_EMISSIVE = 0.6;
const TAIL_BRAKE_EMISSIVE = 2;
/** Rear corona/glass is dim "running" at night, full when braking (× config). */
const REAR_RUNNING = 0.4;

/**
 * ⚠️ MVP — to be redone properly. Turns the **occupied** car's headlights on at night with two cheap parts:
 * (1) the lamp **glass glows** (head/tail materials tagged near the light dummies self-illuminate — head warm-
 * white, tail red dim/brake — bloom makes the halo); (2) a small **corona** flare at each lamp, faded by
 * viewing angle. Gated on `seated && isNight()` (occupant-agnostic — generalises to NPC traffic).
 *
 * Known MVP limitations (see plan 033): no light on the road/world (it's unlit/prelit), so no headlight beam
 * trail on the asphalt. A proper redo would project the beam onto the road polygons (SA `CShadows`-style
 * decal). Rejected dead-ends (do NOT retry as-is): flat ground decal/pool (sliced by geometry, reads badly),
 * a real SpotLight (can't light the unlit world; barely visible on dynamics).
 */
export class VehicleHeadlightSystem implements System {
  readonly name = 'vehicle-headlights';

  private readonly camera: Camera;
  /** Camera position in the streaming root's local (GTA Z-up) space — for the per-lamp corona facing fade. */
  private readonly camLocal = new Vector3();
  private readonly config: () => HeadlightConfig;
  /** Lamp coronas: [frontLeft, frontRight, rearLeft, rearRight]. */
  private readonly coronas: Sprite[];
  private readonly dir = new Vector3();
  private readonly enter: EnterVehicleSystem;
  private readonly forward = new Vector3();
  private readonly isNight: () => boolean;
  private lit: EnterableVehicle | null = null;
  private readonly root: Object3D;
  /** The lit car's tail/brake glass materials — their emissive brightens per-frame while braking. */
  private tails: MeshStandardMaterial[] = [];
  private readonly tmp = new Vector3();

  constructor(
    enter: EnterVehicleSystem,
    isNight: () => boolean,
    root: Object3D,
    config: () => HeadlightConfig,
    glowLayer: number,
    camera: Camera,
  ) {
    this.enter = enter;
    this.isNight = isNight;
    this.root = root;
    this.config = config;
    this.camera = camera;

    const map = coronaTexture(); // soft round glow
    this.coronas = [HEAD_COLOR, HEAD_COLOR, TAIL_COLOR, TAIL_COLOR].map((color) => {
      const corona = new Sprite(
        new SpriteMaterial({ blending: AdditiveBlending, color, depthWrite: false, fog: false, map }),
      );
      corona.visible = false;
      corona.name = 'HeadlightCorona';
      corona.layers.set(glowLayer); // excluded from the SSAO normal prepass (see GLOW_LAYER)
      root.add(corona);

      return corona;
    });
  }

  update(): void {
    const active = this.enter.getActive();
    const target = active && this.enter.isSeated() && this.isNight() ? active : null;
    const cfg = this.config();
    if (target !== this.lit) {
      if (this.lit) {
        this.tails = [];
        setLamps(this.lit, false, cfg.intensity);
      }
      if (target) {
        this.tails = setLamps(target, true, cfg.intensity);
      }
      this.lit = target;
    }
    if (!target) {
      for (const corona of this.coronas) {
        corona.visible = false;
      }

      return;
    }
    const braking = this.enter.isBraking();
    const tail = (braking ? TAIL_BRAKE_EMISSIVE : TAIL_RUN_EMISSIVE) * cfg.intensity;
    for (const mat of this.tails) {
      mat.emissiveIntensity = tail;
    }
    this.placeCoronas(target, cfg, braking);
  }

  /** Place + fade the four lamp coronas at the model's `headlights`/`taillights` dummies (mirrored ±X), each
   *  dimmed by how much its lamp faces the camera (front +Y, rear −Y) so it only shows from the right side.
   *  Rear coronas run dim and brighten on braking. */
  private placeCoronas(vehicle: EnterableVehicle, cfg: HeadlightConfig, braking: boolean): void {
    const [hx, hy, hz] = vehicle.halfExtents;
    const front = (vehicle.object.userData.headlightDummy as [number, number, number] | null) ?? [
      hx * 0.7,
      hy * 0.9,
      -hz * 0.3,
    ];
    const rear = (vehicle.object.userData.taillightDummy as [number, number, number] | null) ?? [
      hx * 0.7,
      -hy * 0.9,
      -hz * 0.3,
    ];
    const { position, quaternion } = vehicle.object;
    this.camLocal.copy(this.camera.getWorldPosition(this.tmp));
    this.root.worldToLocal(this.camLocal); // camera in root-local (Z-up) space, where the lamps live
    const rearIntensity = cfg.coronaIntensity * (braking ? 1 : REAR_RUNNING);
    // [localX, localY, localZ, index, isRear]
    const lamps: [number, number, number, number, boolean][] = [
      [front[0], front[1], front[2], 0, false],
      [-front[0], front[1], front[2], 1, false],
      [rear[0], rear[1], rear[2], 2, true],
      [-rear[0], rear[1], rear[2], 3, true],
    ];
    for (const [lx, ly, lz, index, isRear] of lamps) {
      const corona = this.coronas[index];
      this.tmp.set(lx, ly, lz).applyQuaternion(quaternion);
      corona.position.set(position.x + this.tmp.x, position.y + this.tmp.y, position.z + this.tmp.z);
      this.forward.set(0, isRear ? -1 : 1, 0).applyQuaternion(quaternion);
      this.dir.copy(this.camLocal).sub(corona.position).normalize();
      const facing = Math.max(this.forward.dot(this.dir), 0);
      const fade = facing * facing; // sharpen so the corona is clearly off from the side/behind
      corona.material.opacity = (isRear ? rearIntensity : cfg.coronaIntensity) * fade;
      corona.visible = fade > 0.01;
      corona.scale.setScalar(cfg.coronaSize * (isRear && braking ? 1.25 : 1));
    }
  }
}

/** A soft round corona (gentle glow, faint halo — NOT a solid disc) for the additive lamp flares. */
function coronaTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}

/**
 * Glow (or clear) the car's tagged lamp glass. Head goes warm-white at full; tail goes red at its dim running
 * level (returned so the caller brightens it while braking). Off resets emissive. Returns the tail materials.
 */
function setLamps(vehicle: EnterableVehicle, on: boolean, intensity: number): MeshStandardMaterial[] {
  const tails: MeshStandardMaterial[] = [];
  vehicle.object.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = material as MeshStandardMaterial;
      const type = mat.userData.lightType as 'head' | 'tail' | undefined;
      if (!type) {
        continue;
      }
      if (!on) {
        mat.emissive.setHex(0x000000);
        mat.emissiveIntensity = 1;
        continue;
      }
      mat.emissive.setHex(type === 'head' ? HEAD_COLOR : TAIL_COLOR);
      mat.emissiveIntensity = (type === 'head' ? HEAD_EMISSIVE : TAIL_RUN_EMISSIVE) * intensity;
      if (type === 'tail') {
        tails.push(mat);
      }
    }
  });

  return tails;
}
