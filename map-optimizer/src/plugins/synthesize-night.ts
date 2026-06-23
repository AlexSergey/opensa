import type { MapPlugin } from '../core/asset';

/**
 * Give **night-less** map models a synthesized night vertex-colour set so they don't go dark at night (plan
 * 013). The engine (plan 038, `world-material.ts`) lights a model that has day prelit but **no** night set with
 * `day prelit × worldTint`, and the world tint sinks into the dark night ambient — so a perfectly fine daytime
 * building (e.g. the dirty-re-export `casroyale*_lvs`, which lost their night data) is multiplied down to near
 * black at night. Models that *have* a night set instead blend to it under a tint that relaxes to white, so
 * they keep their look. We synthesize the missing night set from the day prelit (optionally scaled by
 * `nightScale`), which flips the model onto that non-darkening path.
 *
 * Conservative guards: only models bright enough by day (`mean luma > minLuma`) are touched — genuinely dark
 * geometry is meant to stay dark — and models whose day-prelit **alpha is overloaded** (any alpha < 255: wind
 * sway weights / floodlight cones, see `build-clump.ts`) are skipped entirely, since they aren't plain opaque
 * surfaces. The new night set is opaque (alpha 255; the engine ignores night alpha anyway).
 */

const DEFAULTS = { minLuma: 32, nightScale: 1 };

export interface SynthesizeNightOptions {
  /** Skip models whose mean day-prelit luma (0–255) is at or below this — they're meant to be dark. Default 32. */
  minLuma?: number;
  /** RGB scale applied to the copied day prelit when building the night set. 1 = verbatim. Default 1. */
  nightScale?: number;
}

export function createSynthesizeNight(options: SynthesizeNightOptions = {}): MapPlugin {
  return {
    name: 'synthesize-night',
    transform(asset, context): void {
      let added = 0;
      for (const mesh of asset.ir.meshes) {
        if (!mesh.prelitColors || mesh.nightColors) {
          continue; // no day prelit to derive from, or it already has a night set
        }
        const night = synthesizeNight(mesh.prelitColors, options);
        if (night) {
          mesh.nightColors = night;
          added += 1;
        }
      }
      if (added > 0) {
        asset.dirty = true;
        context.log(asset, 'synthesize-night', `added ${added} night set(s)`);
      }
    },
  };
}

/**
 * Derive a night RGBA buffer from a day-prelit RGBA buffer, or `null` when the model should keep no night set
 * (too dark by day, or its prelit alpha is overloaded). RGB is the day prelit scaled by `nightScale`; alpha is
 * forced to 255 (night alpha is unused by the engine).
 */
export function synthesizeNight(prelit: Uint8Array, options: SynthesizeNightOptions = {}): null | Uint8Array {
  const minLuma = options.minLuma ?? DEFAULTS.minLuma;
  const nightScale = options.nightScale ?? DEFAULTS.nightScale;
  const count = prelit.length / 4;
  if (count === 0) {
    return null;
  }

  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    if (prelit[i * 4 + 3] < 255) {
      return null; // overloaded day-prelit alpha (wind / floodlight) — not a plain surface, leave it
    }
    sum += prelit[i * 4] + prelit[i * 4 + 1] + prelit[i * 4 + 2];
  }
  if (sum / (count * 3) <= minLuma) {
    return null; // dark by day too — keep it dark at night
  }

  const out = new Uint8Array(prelit.length);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = clamp(Math.round(prelit[i * 4] * nightScale));
    out[i * 4 + 1] = clamp(Math.round(prelit[i * 4 + 1] * nightScale));
    out[i * 4 + 2] = clamp(Math.round(prelit[i * 4 + 2] * nightScale));
    out[i * 4 + 3] = 255;
  }

  return out;
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
