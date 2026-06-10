import type { MeshStandardMaterial } from 'three';

import { Color } from 'three';

/**
 * Cheap night "fill" for DYNAMIC objects (player + vehicles) — plan 034. They lack the static map's
 * baked **night vertex colours**, so at night (real lights ≈ 0) they render black. This is a shader-only term —
 * **no extra lights / draws / passes** — added as emissive and faded by {@link nightFillUniform}: a fake
 * hemisphere (moonlight from "above") for form + a fresnel rim for edge definition. Stylised, not physical;
 * revisit with the shadow rework. (View-space normal → the "up" is camera-relative; fine for a subtle look.)
 */

/** Fade 0 (day) → strength (deep night). Driven each frame in canvas-host from the night factor. */
export const nightFillUniform = { value: 0 };
/** Cool moonlight from "above" and its darker bounce from below (prototype defaults; tune later). */
export const nightFillSky = { value: new Color(0.55, 0.62, 0.8) };
export const nightFillGround = { value: new Color(0.18, 0.2, 0.26) };
/** Fresnel-rim strength (faint cool edge sheen, additive). */
export const nightFillRim = { value: 0.1 };

// Key idea: the hemispheric moonlight **modulates the object's own albedo** (diffuseColor = texture × colour,
// already resolved here) — so the car paint / CJ's clothes show, just dimly moonlit, instead of a flat grey
// emissive wash. Only the faint fresnel rim is additive (a cool sheen on the silhouette).
const NIGHT_FILL_GLSL = `#include <emissivemap_fragment>
\t{
\t\tfloat nfHemi = normal.y * 0.5 + 0.5; // view-space up (camera-relative — prototype simplification)
\t\tvec3 nfMoon = mix( uFillGround, uFillSky, nfHemi ) * uNightFill;
\t\ttotalEmissiveRadiance += nfMoon * diffuseColor.rgb;
\t\tfloat nfRim = pow( clamp( 1.0 - dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 ), 3.0 );
\t\ttotalEmissiveRadiance += uFillRim * nfRim * uNightFill * uFillSky;
\t}`;

/**
 * Patch a dynamic-object material to self-illuminate at night (plan 034). **Composes** with any
 * existing `onBeforeCompile` (e.g. the vehicle env-map reflection) instead of clobbering it, and appends a
 * cache-key suffix so these materials never share a (fill-less) cached program with a same-param map material.
 * Injected after `<emissivemap_fragment>` where `normal` + `vViewPosition` exist (same anchor as the reflection).
 */
export function applyNightFill(material: MeshStandardMaterial): void {
  // Bind now (not capture) so chaining doesn't clobber the reflection's onBeforeCompile / lose `this`.
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = (): string => `${previousKey()}|nightFill`;
  material.onBeforeCompile = (shader, renderer): void => {
    previousCompile(shader, renderer);
    shader.uniforms.uNightFill = nightFillUniform;
    shader.uniforms.uFillSky = nightFillSky;
    shader.uniforms.uFillGround = nightFillGround;
    shader.uniforms.uFillRim = nightFillRim;
    shader.fragmentShader =
      'uniform float uNightFill;\nuniform vec3 uFillSky;\nuniform vec3 uFillGround;\nuniform float uFillRim;\n' +
      shader.fragmentShader.replace('#include <emissivemap_fragment>', NIGHT_FILL_GLSL);
  };
  material.needsUpdate = true;
}
