import type { MeshBasicMaterial } from 'three';

import type { IdeObjectDef, RenderPart } from '../../renderware';
import type { WorldMod, WorldModUpdateContext } from './mod.interface';

import { hasIdeFlag, IdeFlag } from '../../renderware';
import { WIND_MODELS } from './wind-mode';

/**
 * Vegetation wind mod (plan 039 iteration 4b/5). Sways vegetation the way the source community mod
 * does: the TRIGGER is membership in {@link WIND_MODELS} (the mod's own coverage) or the SA IDE
 * IS_TREE/IS_PALM bits; the per-vertex weights come from wind-ADAPTED DFFs, whose day-prelit ALPHA
 * encodes sway weight (255 = rigid trunk, lower = swaying canopy — decoded into the `swayWeight`
 * attribute + `RenderPart.swayAlphaMin` by `buildClumpParts`). Prelit alpha alone must NOT trigger
 * sway: roads/night overlays use it too (128 false positives on the first attempt).
 */

/** Wind clock (seconds), shared by every swaying material's program. */
const windTimeUniform = { value: 0 };

/** Sway tuning per vegetation kind: bushes flutter fast/small, palms swing slow/wide. The `height`
 *  amplitude multiplies metres above the model base; the `weight` amplitude multiplies the
 *  per-vertex prelit-alpha weight (0..1 — wind-adapted assets). */
const SWAY = {
  palm: { heightAmplitude: 0.035, speed: 0.9, weightAmplitude: 0.5 },
  tree: { heightAmplitude: 0.02, speed: 1.6, weightAmplitude: 0.35 },
} as const;

/** Create the wind mod: install with `game.installMod(...)` AND pass to the adapter's `mods`. */
export function createWindMod(): WorldMod {
  return {
    decoratePart(def: IdeObjectDef, part: RenderPart): void {
      const kind = swayKindFor(def);
      if (kind) {
        // Adapted assets carry per-vertex weights in the prelit alpha; others sway by height.
        applyWindSway(part.material, kind, part.swayAlphaMin === undefined ? 'height' : 'weight');
      }
    },
    name: 'wind',
    update(context: WorldModUpdateContext): void {
      windTimeUniform.value = context.seconds;
    },
  };
}

/**
 * Patch a vegetation material to sway in the wind, phased by the instance's translation so a row
 * of palms doesn't move in lockstep. Two weight sources: `height` — offset ∝ height above the
 * model base (z = 0 in native Z-up model space); `weight` — offset ∝ the `swayWeight` attribute.
 * Runs on `transformed` right after `begin_vertex`, BEFORE the world material's shadow projection —
 * so the swaying canopy's received shadow coordinates follow it. Composes with the material's
 * existing `onBeforeCompile` (the world-material pattern).
 */
function applyWindSway(material: MeshBasicMaterial, kind: keyof typeof SWAY, mode: 'height' | 'weight'): void {
  const { heightAmplitude, speed, weightAmplitude } = SWAY[kind];
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = (): string => `${previousKey()}|sway-${kind}-${mode}`;
  material.onBeforeCompile = (shader, renderer): void => {
    previousCompile(shader, renderer);
    shader.uniforms.uWindTime = windTimeUniform;
    const amount =
      mode === 'weight'
        ? `swayWeight * ${weightAmplitude.toFixed(3)}`
        : `max( transformed.z, 0.0 ) * ${heightAmplitude.toFixed(3)}`;
    shader.vertexShader =
      `uniform float uWindTime;\n${mode === 'weight' ? 'attribute float swayWeight;\n' : ''}` +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
          '{\n' +
          '\tvec3 swayRef = vec3( 0.0 );\n' +
          '#ifdef USE_INSTANCING\n' +
          '\tswayRef = vec3( instanceMatrix[ 3 ] );\n' +
          '#endif\n' +
          `\tfloat swayT = uWindTime * ${speed.toFixed(3)} + swayRef.x * 0.21 + swayRef.y * 0.17;\n` +
          `\tfloat swayAmount = ${amount};\n` +
          '\ttransformed.x += sin( swayT ) * swayAmount;\n' +
          '\ttransformed.y += cos( swayT * 0.7 ) * swayAmount * 0.6;\n' +
          '}',
      );
  };
  material.needsUpdate = true;
}

/** Sway kind for a def: IDE veg flags first, then the wind list ('palm' by name there — a tuning
 *  choice, not a trigger: palms swing slower/wider). Null = does not sway. */
function swayKindFor(def: IdeObjectDef): 'palm' | 'tree' | null {
  if (hasIdeFlag(def, IdeFlag.IS_PALM)) {
    return 'palm';
  }
  if (hasIdeFlag(def, IdeFlag.IS_TREE)) {
    return 'tree';
  }
  const model = def.modelName.toLowerCase();
  if (!WIND_MODELS.has(model)) {
    return null;
  }

  return model.includes('palm') ? 'palm' : 'tree';
}
