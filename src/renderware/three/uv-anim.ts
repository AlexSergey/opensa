import type { MeshBasicMaterial } from 'three';

import { Vector4 } from 'three';

import type { RWUvAnimation } from '../parsers/binary/types';

/**
 * UV-animated map textures (plan 041): DFFs like the LV skull sign open with a UVAnimDict whose
 * entries materials reference by name (UV Anim PLG 0x135). The TXD texture cache is shared, so
 * animating `texture.offset` would scroll every user of that texture — instead each dict entry
 * owns a shared uniform that a world-material variant consumes, advanced once per frame by the
 * game loop ({@link updateUvAnimations}). Vanilla also plays these globally per material (every
 * instance in sync), so one uniform per animation matches SA exactly.
 */

interface UvAnimEntry {
  readonly duration: number;
  /** Sorted by time. `uv` order is the RtAnim stream order — see {@link RWUvAnimation}. */
  readonly keyframes: readonly { readonly time: number; readonly uv: readonly number[] }[];
  /** (offsetX, offsetY, scaleX, scaleY) applied to the map UV by the shader variant. */
  readonly uniform: { value: Vector4 };
}

/** Indices into a keyframe's `uv` params: (rotation, scaleX, scaleY, skew, translateX, translateY). */
const UV_SCALE_X = 1;
const UV_SCALE_Y = 2;
const UV_TRANSLATE_X = 4;
const UV_TRANSLATE_Y = 5;

/** Dict entries by name. Module-level on purpose: SA dict-entry names are global identifiers
 *  (materials in any DFF may reference them), mirroring RW's single UV-anim dictionary. */
const registry = new Map<string, UvAnimEntry>();

/**
 * Patch a world material to play a UV animation: `mapUv = mapUv * scale + offset` from the shared
 * uniform, injected after the stock UV transform. Composes with the material's existing
 * `onBeforeCompile` like `applyWorldWindowGlow` (rotation/skew params are unused by known assets).
 */
export function applyWorldUvAnim(material: MeshBasicMaterial, uniform: { value: Vector4 }): void {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = (): string => `${previousKey()}|uvAnim`;
  material.onBeforeCompile = (shader, renderer): void => {
    previousCompile(shader, renderer);
    shader.uniforms.uUvAnim = uniform;
    shader.vertexShader =
      'uniform vec4 uUvAnim;\n' +
      shader.vertexShader.replace(
        '#include <uv_vertex>',
        '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = vMapUv * uUvAnim.zw + uUvAnim.xy;\n#endif',
      );
  };
  material.needsUpdate = true;
}

/** The shared transform uniform for a registered animation, or undefined if the name is unknown
 *  (material plugin referencing a dict the DFF didn't carry — render static rather than crash). */
export function getUvAnimUniform(name: string): undefined | { value: Vector4 } {
  return registry.get(name)?.uniform;
}

/** Register a clump's UVAnimDict entries (idempotent by name; empty-keyframe entries are skipped). */
export function registerUvAnimations(animations: readonly RWUvAnimation[]): void {
  for (const animation of animations) {
    if (registry.has(animation.name) || animation.keyframes.length === 0) {
      continue;
    }
    registry.set(animation.name, {
      duration: animation.duration,
      keyframes: [...animation.keyframes].sort((a, b) => a.time - b.time),
      uniform: { value: new Vector4(0, 0, 1, 1) },
    });
  }
}

/** Test hook: drop all registered animations (the registry is module-level shared state). */
export function resetUvAnimations(): void {
  registry.clear();
}

/** Advance every registered animation to wall-clock `seconds`, looping over its duration.
 *  Generic keyframe-pair lerp: equal-time keyframe pairs (DolSign's stepped flipbook) read the
 *  later key, so steps snap instead of blending. */
export function updateUvAnimations(seconds: number): void {
  for (const entry of registry.values()) {
    const time = entry.duration > 0 ? seconds % entry.duration : 0;
    const keyframes = entry.keyframes;
    let index = keyframes.length - 1;
    while (index > 0 && keyframes[index].time > time) {
      index -= 1;
    }
    const k0 = keyframes[index];
    const k1 = keyframes[Math.min(index + 1, keyframes.length - 1)];
    const span = k1.time - k0.time;
    const f = span > 1e-6 ? Math.min(Math.max((time - k0.time) / span, 0), 1) : 0;
    entry.uniform.value.set(
      k0.uv[UV_TRANSLATE_X] + (k1.uv[UV_TRANSLATE_X] - k0.uv[UV_TRANSLATE_X]) * f,
      k0.uv[UV_TRANSLATE_Y] + (k1.uv[UV_TRANSLATE_Y] - k0.uv[UV_TRANSLATE_Y]) * f,
      k0.uv[UV_SCALE_X] + (k1.uv[UV_SCALE_X] - k0.uv[UV_SCALE_X]) * f,
      k0.uv[UV_SCALE_Y] + (k1.uv[UV_SCALE_Y] - k0.uv[UV_SCALE_Y]) * f,
    );
  }
}
