import type { MapPlugin } from '../core/asset';

/**
 * Pull pathologically **dark** or **bright** day-prelit back to a neutral level so the prelit-lit map (plan
 * 038) doesn't render a model ~black or fullbright. Conservative: only models whose mean prelit brightness is
 * outside `[darkThreshold, brightThreshold]` are touched; the rest keep their baked AO. The fix is an
 * **additive luma shift** (mean → target) applied to **RGB only**, which preserves per-vertex contrast (the
 * AO) and lifts a flat-black model cleanly. The prelit **alpha is copied verbatim** — it carries wind sway
 * weights / floodlight cones / overlays (see `build-clump.ts`), never brightness.
 *
 * The **dark** rescue is additionally gated on near-**uniformity** (`maxLuma - minLuma ≤ maxDarkSpread`): only
 * flat near-black prelit (the "exported to black" signature) is lifted. A dark model that still has spread is
 * carrying real baked shading (e.g. a deliberately dark planter) — lifting it would clamp its bright texels and
 * wash it out, so it's left alone.
 */

const DEFAULTS = { brightThreshold: 248, darkThreshold: 24, maxDarkSpread: 16, targetLuma: 200 };

export interface ConditionPrelitOptions {
  /** Mean prelit brightness (0–255) above which a model is "too bright". Default 248. */
  brightThreshold?: number;
  /** Mean prelit brightness (0–255) below which a model is "too dark". Default 24. */
  darkThreshold?: number;
  /** Max luma spread (max − min) for a dark model to count as flat-black and be rescued. Default 16. */
  maxDarkSpread?: number;
  /** The neutral brightness dark/bright models are shifted toward. Default 200. */
  targetLuma?: number;
}

/**
 * Re-level a prelit RGBA buffer, or `null` if it's already healthy (or dark-but-structured). Shifts RGB by
 * `target - mean` (clamped), preserving contrast; alpha is carried through unchanged.
 */
export function conditionPrelit(prelit: Uint8Array, options: ConditionPrelitOptions = {}): null | Uint8Array {
  const darkThreshold = options.darkThreshold ?? DEFAULTS.darkThreshold;
  const brightThreshold = options.brightThreshold ?? DEFAULTS.brightThreshold;
  const maxDarkSpread = options.maxDarkSpread ?? DEFAULTS.maxDarkSpread;
  const target = options.targetLuma ?? DEFAULTS.targetLuma;
  const count = prelit.length / 4;
  if (count === 0) {
    return null;
  }

  let sum = 0;
  let minLuma = 255;
  let maxLuma = 0;
  for (let i = 0; i < count; i += 1) {
    const luma = (prelit[i * 4] + prelit[i * 4 + 1] + prelit[i * 4 + 2]) / 3;
    sum += prelit[i * 4] + prelit[i * 4 + 1] + prelit[i * 4 + 2];
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
  }
  const mean = sum / (count * 3);
  const tooDark = mean < darkThreshold;
  const tooBright = mean > brightThreshold;
  if (!tooDark && !tooBright) {
    return null; // healthy — leave the baked AO alone
  }
  if (tooDark && maxLuma - minLuma > maxDarkSpread) {
    return null; // dark but structured — real baked shading, don't wash it out
  }

  const delta = Math.round(target - mean);
  const out = new Uint8Array(prelit.length);
  for (let i = 0; i < count; i += 1) {
    out[i * 4] = clamp(prelit[i * 4] + delta);
    out[i * 4 + 1] = clamp(prelit[i * 4 + 1] + delta);
    out[i * 4 + 2] = clamp(prelit[i * 4 + 2] + delta);
    out[i * 4 + 3] = prelit[i * 4 + 3]; // alpha verbatim (wind / floodlight / overlay data)
  }

  return out;
}

export function createConditionPrelit(options: ConditionPrelitOptions = {}): MapPlugin {
  return {
    name: 'condition-prelit',
    transform(asset, context): void {
      let changed = 0;
      for (const mesh of asset.ir.meshes) {
        if (!mesh.prelitColors) {
          continue;
        }
        const conditioned = conditionPrelit(mesh.prelitColors, options);
        if (conditioned) {
          mesh.prelitColors = conditioned;
          changed += 1;
        }
      }
      if (changed > 0) {
        asset.dirty = true;
        context.log(asset, 'condition-prelit', `re-leveled ${changed} prelit set(s)`);
      }
    },
  };
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
