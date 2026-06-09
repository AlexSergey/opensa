import {
  AdditiveBlending,
  CanvasTexture,
  type Mesh,
  type MeshStandardMaterial,
  type Object3D,
  SpotLight,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';

import type { System } from '../core/system';
import type { EnterableVehicle, EnterVehicleSystem } from './enter-vehicle.system';

/** Spotlight tuning (warm white cone onto the road ahead). Position/aim derived from the body half-extents. */
const SPOT_COLOR = 0xfff0d0;
const SPOT_INTENSITY = 8;
const SPOT_ANGLE = Math.PI / 7;
const SPOT_PENUMBRA = 0.5;
const SPOT_DISTANCE = 35;
const SPOT_DECAY = 1.5;

/** Headlight glow sprite (additive corona at the lamp, depth-tested so the car body occludes it from behind). */
const GLOW_SIZE = 0.35;

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

  private readonly enter: EnterVehicleSystem;
  /** One additive glow corona per lamp (the visible "on" flare), hidden when the lights are off. */
  private readonly glows: Sprite[];
  private readonly isNight: () => boolean;
  private lit: EnterableVehicle | null = null;
  /** One spotlight per lamp (left/right), placed at the model's headlight dummy positions. */
  private readonly spots: SpotLight[];

  constructor(enter: EnterVehicleSystem, isNight: () => boolean, root: Object3D) {
    this.enter = enter;
    this.isNight = isNight;
    const glowMap = glowTexture(); // shared by both lamps
    this.spots = [0, 1].map(() => {
      const spot = new SpotLight(SPOT_COLOR, 0, SPOT_DISTANCE, SPOT_ANGLE, SPOT_PENUMBRA, SPOT_DECAY);
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
      glow.scale.setScalar(GLOW_SIZE);
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
    for (const spot of this.spots) {
      spot.intensity = target ? SPOT_INTENSITY : 0;
    }
    for (const glow of this.glows) {
      glow.visible = target !== null;
    }
  }

  /** Place the two spotlights at the lamps (the model's `headlights` dummy, mirrored ±X; else front of the
   *  body from half-extents) and aim each forward + down (GTA Z-up, heading about Z). */
  private aim(vehicle: EnterableVehicle): void {
    const [hx, hy, hz] = vehicle.halfExtents;
    const [px, py, pz] = vehicle.position;
    const dummy = vehicle.object.userData.headlightDummy as [number, number, number] | null | undefined;
    const lx = dummy ? dummy[0] : hx * 0.7; // lamp side offset
    const ly = dummy ? dummy[1] : hy * 0.9; // front (+Y)
    const lz = dummy ? dummy[2] : -hz * 0.3; // lamp height (low)
    const cos = Math.cos(vehicle.heading);
    const sin = Math.sin(vehicle.heading);
    const aimY = ly + 9; // a point well ahead of the lamps
    const aimZ = pz - hz * 1.6; // forward + down onto the road
    const glowY = ly + 0.15; // the glow sits just in front of the lamp surface (avoids z-fighting it)
    this.spots.forEach((spot, i) => {
      const sx = i === 0 ? lx : -lx; // left / right lamp
      // Local (sx, ly, lz) rotated by heading about Z: x = sx·cos − ly·sin, y = sx·sin + ly·cos.
      spot.position.set(px + sx * cos - ly * sin, py + sx * sin + ly * cos, pz + lz);
      spot.target.position.set(px + sx * cos - aimY * sin, py + sx * sin + aimY * cos, aimZ); // parallel beam
      this.glows[i].position.set(px + sx * cos - glowY * sin, py + sx * sin + glowY * cos, pz + lz);
    });
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
