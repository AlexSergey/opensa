import {
  AdditiveBlending,
  CanvasTexture,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  type Quaternion,
  SpotLight,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector3,
} from 'three';

import type { System } from '../core/system';
import type { HeadlightConfig } from '../interfaces/config.interface';
import type { EnterableVehicle, EnterVehicleSystem } from './enter-vehicle.system';

/** Spotlight look (warm white cone). Intensity/reach/angle + glow size are config (live); these stay fixed. */
const SPOT_COLOR = 0xfff0d0;
const SPOT_PENUMBRA = 0.5;
const SPOT_DECAY = 1.5;

/**
 * Turns the **occupied** car's headlights on at night: swaps the front-light texture to its lit variant
 * (`vehiclelights128 → vehiclelightson128`, tagged on the materials by `build-vehicle`), shows an additive
 * glow **corona** at each lamp, and aims two warm `SpotLight`s (one per lamp, at the model's `headlights`
 * dummy) forward-and-down onto the road. Gated on `seated && isNight()` (occupant-agnostic — generalises to
 * NPC traffic once it exists). The spotlights live permanently in the scene (constant light count → no shader
 * recompiles); only their position/intensity (and the coronas' visibility) change as the player drives.
 */
export class VehicleHeadlightSystem implements System {
  readonly name = 'vehicle-headlights';

  private readonly config: () => HeadlightConfig;
  private readonly enter: EnterVehicleSystem;
  /** One additive glow corona per lamp (the visible "on" flare), hidden when the lights are off. */
  private readonly glows: Sprite[];
  private readonly isNight: () => boolean;
  private lit: EnterableVehicle | null = null;
  /** One spotlight per lamp (left/right), placed at the model's headlight dummy positions. */
  private readonly spots: SpotLight[];
  /** Scratch for transforming local lamp offsets by the car's world transform. */
  private readonly tmp = new Vector3();

  constructor(enter: EnterVehicleSystem, isNight: () => boolean, root: Object3D, config: () => HeadlightConfig) {
    this.enter = enter;
    this.isNight = isNight;
    this.config = config;
    const glowMap = glowTexture(); // shared by both lamps
    this.spots = [0, 1].map(() => {
      const spot = new SpotLight(SPOT_COLOR, 0, 0, Math.PI / 7, SPOT_PENUMBRA, SPOT_DECAY);
      spot.castShadow = false; // headlight shadows are too costly for the payoff
      spot.name = 'Headlight';
      root.add(spot, spot.target); // persistent: keeps the world's light count constant

      return spot;
    });
    this.glows = [0, 1].map(() => {
      const glow = new Sprite(
        new SpriteMaterial({
          blending: AdditiveBlending,
          color: SPOT_COLOR,
          depthWrite: false,
          fog: false,
          map: glowMap,
        }),
      );
      glow.visible = false;
      glow.name = 'HeadlightGlow';
      root.add(glow);

      return glow;
    });
  }

  update(): void {
    const active = this.enter.getActive();
    const target = active && this.enter.isSeated() && this.isNight() ? active : null;
    if (target !== this.lit) {
      if (this.lit) {
        setHeadlights(this.lit, false);
      }
      if (target) {
        setHeadlights(target, true);
      }
      this.lit = target;
    }
    if (target) {
      this.aim(target);
    }
    const cfg = this.config(); // live: beam strength / reach / cone size + lamp glow size
    for (const spot of this.spots) {
      spot.intensity = target ? cfg.intensity : 0;
      spot.distance = cfg.distance;
      spot.angle = cfg.angle;
    }
    for (const glow of this.glows) {
      glow.visible = target !== null;
      glow.scale.setScalar(cfg.glow);
    }
  }

  /** Place the two spotlights at the lamps (the model's `headlights` dummy, mirrored ±X; else front of the
   *  body from half-extents) and aim each forward + down. Lamp offsets are transformed by the car's **full**
   *  world orientation (`object.quaternion`), so the lamps + beams tilt with the body on slopes (not just yaw). */
  private aim(vehicle: EnterableVehicle): void {
    const [hx, hy, hz] = vehicle.halfExtents;
    const dummy = vehicle.object.userData.headlightDummy as [number, number, number] | null | undefined;
    const lx = dummy ? dummy[0] : hx * 0.7; // lamp side offset
    const ly = dummy ? dummy[1] : hy * 0.9; // front (+Y)
    const lz = dummy ? dummy[2] : -hz * 0.3; // lamp height (low)
    const { position, quaternion } = vehicle.object;
    this.spots.forEach((spot, i) => {
      const sx = i === 0 ? lx : -lx; // left / right lamp
      // Each point is a car-local offset rotated into the world by the body quaternion (incl. pitch/roll).
      this.toWorld(sx, ly, lz, quaternion, position, spot.position); // lamp
      this.toWorld(sx, ly + 9, lz - hz * 1.6, quaternion, position, spot.target.position); // forward + down
      this.toWorld(sx, ly + 0.15, lz, quaternion, position, this.glows[i].position); // glow just ahead of lamp
    });
  }

  /** Write car-local `(x, y, z)` rotated by `quaternion` and offset by `position` into `out` (world space). */
  private toWorld(x: number, y: number, z: number, quaternion: Quaternion, position: Vector3, out: Vector3): void {
    out.copy(this.tmp.set(x, y, z).applyQuaternion(quaternion)).add(position);
  }
}

/** A soft radial glow (white centre → transparent) for the additive headlight corona sprites. */
function glowTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new CanvasTexture(canvas);
}

/**
 * Swap the tagged front-light materials between their day (`lightsOffMap`) and lit (`lightsOnMap`) variant,
 * like SA. Only the **map** is swapped — no material emissive: `vehiclelights128` is a shared atlas (head/tail
 * lights, indicators, even mirrors on some cars), so an emissive boost lit up non-light regions (e.g. the
 * camper's mirrors). The actual glow comes from the two spotlights; the lit texture reads as "on".
 */
function setHeadlights(vehicle: EnterableVehicle, on: boolean): void {
  vehicle.object.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = material as MeshStandardMaterial;
      const onMap = mat.userData.lightsOnMap as Texture | undefined;
      const offMap = mat.userData.lightsOffMap as Texture | undefined;
      if (onMap && offMap) {
        mat.map = on ? onMap : offMap;
        mat.needsUpdate = true;
      }
    }
  });
}
