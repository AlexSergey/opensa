import type { Texture } from 'three';

import { Color, DoubleSide, FrontSide, Matrix4, MeshBasicMaterial, Vector2 } from 'three';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';

/**
 * SA prelit world material (plan 038): the static map rendered the way SA's
 * `CCustomBuildingDNPipeline` does — **unlit**, `texture × mix(day prelit, night prelit, dnBalance)
 * × world tint`. Vertex normals are never read (they stay in the geometry for SSAO's normal
 * prepass); the sun/ambient lights only affect dynamic objects, which keep the lit path.
 */

/** Day↔night prelit balance (0 day → 1 night), the SA DNBalance. Driven each frame by the game from
 *  the shared wall-clock fade (`clockNightFactor`) — the same clock the lit windows/tonemap ride. */
export const dnBalanceUniform = { value: 0 };

/** Global world tint for **no-night-prelit** models (most LODs): follows the sun through the day
 *  (white at noon → warm dim at dawn/dusk) and continues into the dark timecyc ambient at night.
 *  Mapping is a calibration knob (plan 038 §2). */
export const worldTintUniform = { value: new Color(1, 1, 1) };

/** Day tint for **night-prelit** models: the same sun-following day dim, but relaxing to WHITE as
 *  dnBalance → 1 — at night their own night prelit set is the final look (tinting it would
 *  double-darken; see the night-blend note below). Keeps dawn/dusk in sync across both variants. */
export const worldDayTintUniform = { value: new Color(1, 1, 1) };

/** Additive glow strength for night-lit timed window overlays — they must glow over the dark night
 *  blend, not just be tinted by it. Driven by the game (base 1.2 × the `night.windowGlow` knob). */
export const windowGlowUniform = { value: 1.2 };

/**
 * Manual shadow-receive for the unlit world (plan 038 iteration 3): the renderer's shadow plumbing
 * only feeds lit materials, so the world material samples the sun's (dynamic-casters-only) shadow
 * map itself. Driven by the game each frame: `uWorldShadowMap`/`uWorldShadowMatrix`/`...MapSize`
 * from the sun's `DirectionalLightShadow`, `uWorldShadowStrength` = day factor × shadow config
 * (0 disables the whole term — also the inert default in 'dynamic' mode).
 */
export const worldShadowUniforms = {
  // Tiny: receivers never cast here (no self-shadow acne possible), and the shadow camera's depth
  // range is long (~900 world units), so 1e-4 ≈ 9 cm — keeps wheel contact shadows tight.
  uWorldShadowBias: { value: 0.0001 },
  /** Debug (`?shadowdebug=1`): paint the shadowed term bright red to isolate it from AO/baking. */
  uWorldShadowDebug: { value: 0 },
  uWorldShadowMap: { value: null as null | Texture },
  uWorldShadowMapSize: { value: new Vector2(2048, 2048) },
  uWorldShadowMatrix: { value: new Matrix4() },
  uWorldShadowStrength: { value: 0 },
};

/** Vertex: project the (instanced) world position into the sun's shadow map space. */
const SHADOW_VERTEX =
  '#include <project_vertex>\n' +
  'vec4 wsWorldPos = vec4( transformed, 1.0 );\n' +
  '#ifdef USE_INSTANCING\n' +
  '\twsWorldPos = instanceMatrix * wsWorldPos;\n' +
  '#endif\n' +
  'wsWorldPos = modelMatrix * wsWorldPos;\n' +
  'vWorldShadowCoord = uWorldShadowMatrix * wsWorldPos;';

/** Fragment: 4-tap PCF over the RGBA-packed depth map; 1.0 = lit (outside the frustum = lit). */
const SHADOW_FRAGMENT_PARS =
  '#include <packing>\n' +
  'uniform sampler2D uWorldShadowMap;\n' +
  'uniform vec2 uWorldShadowMapSize;\n' +
  'uniform float uWorldShadowStrength;\n' +
  'uniform float uWorldShadowBias;\n' +
  'uniform float uWorldShadowDebug;\n' +
  'varying vec4 vWorldShadowCoord;\n' +
  'float worldShadowTap( vec2 uv, float depth ) {\n' +
  '\treturn step( depth, unpackRGBAToDepth( texture2D( uWorldShadowMap, uv ) ) );\n' +
  '}\n' +
  'float worldShadow() {\n' +
  '\tvec3 sc = vWorldShadowCoord.xyz / vWorldShadowCoord.w;\n' +
  '\tif ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 ) return 1.0;\n' +
  '\tfloat d = sc.z - uWorldShadowBias;\n' +
  '\tvec2 t = 0.75 / uWorldShadowMapSize;\n' +
  '\treturn 0.25 * ( worldShadowTap( sc.xy + vec2( -t.x, -t.y ), d ) + worldShadowTap( sc.xy + vec2( t.x, -t.y ), d )\n' +
  '\t\t+ worldShadowTap( sc.xy + vec2( -t.x, t.y ), d ) + worldShadowTap( sc.xy + vec2( t.x, t.y ), d ) );\n' +
  '}\n';

/**
 * Patch a night-lit timed window overlay (build-region) to **glow** additively over the night
 * blend: `+ texture × windowGlow`, injected after the (no-night-variant) world tint so the glow is
 * never dimmed. Composes with the material's existing `onBeforeCompile` like `applyNightFill`.
 */
export function applyWorldWindowGlow(material: MeshBasicMaterial): void {
  const previousCompile = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = (): string => `${previousKey()}|windowGlow`;
  material.onBeforeCompile = (shader, renderer): void => {
    previousCompile(shader, renderer);
    shader.uniforms.uWindowGlow = windowGlowUniform;
    shader.fragmentShader =
      'uniform float uWindowGlow;\n' +
      shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        '#ifdef USE_MAP\n\toutgoingLight += texture2D( map, vMapUv ).rgb * uWindowGlow;\n#endif\n#include <opaque_fragment>',
      );
  };
  material.needsUpdate = true;
}

/**
 * Build the unlit SA world material for one map part. Param parity with `buildMaterial`:
 * texture-alpha → transparent + alphaTest + DoubleSide; untextured → the RW material colour;
 * prelit → vertex colours. When the geometry carries SA night colours (`nightColor` attribute,
 * set by `buildClumpParts`) the day prelit is blended toward them by {@link dnBalanceUniform};
 * everything is then multiplied by {@link worldTintUniform}.
 */
export function buildWorldMaterial(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures?: Map<string, Texture>,
): MeshBasicMaterial {
  const map = rw.texture && textures ? (textures.get(rw.texture.name.toLowerCase()) ?? null) : null;
  const hasVertexColors = (geometry.flags & GeometryFlag.PRELIT) !== 0;
  const transparent = map ? Boolean(map.userData.hasAlpha) : rw.color[3] < 255;

  const material = new MeshBasicMaterial({
    alphaTest: transparent ? 0.5 : 0,
    color: map ? 0xffffff : (rw.color[0] << 16) | (rw.color[1] << 8) | rw.color[2],
    map,
    side: transparent ? DoubleSide : FrontSide,
    transparent,
    vertexColors: hasVertexColors,
  });
  material.name = rw.texture?.name ?? 'material';

  // The night blend needs both prelit sets; day-only geometry keeps the stock vColor multiply.
  // Tinting: no-night geometry (LODs etc.) rides `worldTintUniform` (sun-dimmed day → dark night
  // ambient); night-prelit geometry rides `worldDayTintUniform`, which relaxes to WHITE at night —
  // its night prelit set already IS the night picture, tinting it on top double-darkens it to black.
  const nightBlend = hasVertexColors && geometry.nightColors !== null;
  material.customProgramCacheKey = (): string => (nightBlend ? 'saWorld|night' : 'saWorld');
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uWorldShadowBias = worldShadowUniforms.uWorldShadowBias;
    shader.uniforms.uWorldShadowDebug = worldShadowUniforms.uWorldShadowDebug;
    shader.uniforms.uWorldShadowMap = worldShadowUniforms.uWorldShadowMap;
    shader.uniforms.uWorldShadowMapSize = worldShadowUniforms.uWorldShadowMapSize;
    shader.uniforms.uWorldShadowMatrix = worldShadowUniforms.uWorldShadowMatrix;
    shader.uniforms.uWorldShadowStrength = worldShadowUniforms.uWorldShadowStrength;

    // Both variants are tinted (the day arc must match across the street); they differ in WHICH
    // uniform feeds the slot — night-prelit models get the day-only tint that relaxes to white.
    shader.uniforms.uWorldTint = nightBlend ? worldDayTintUniform : worldTintUniform;

    let vertexPars = 'uniform mat4 uWorldShadowMatrix;\nvarying vec4 vWorldShadowCoord;\n';
    let vertexBody = shader.vertexShader.replace('#include <project_vertex>', SHADOW_VERTEX);
    let fragmentPars = `${SHADOW_FRAGMENT_PARS}uniform vec3 uWorldTint;\n`;
    let fragmentBody = shader.fragmentShader;
    // Dynamic-object shadows darken the unlit world (cars/peds on roads); buildings cast nothing.
    // Debug mode paints the term red so it can't be confused with SSAO or baked prelit darkening.
    const opaque =
      'outgoingLight *= uWorldTint;\n' +
      'float wsShadow = worldShadow();\n' +
      'outgoingLight *= mix( 1.0, wsShadow, uWorldShadowStrength );\n' +
      'if ( uWorldShadowDebug > 0.5 ) outgoingLight = mix( vec3( 1.0, 0.05, 0.05 ), outgoingLight, wsShadow );\n' +
      '#include <opaque_fragment>';

    if (nightBlend) {
      shader.uniforms.uDnBalance = dnBalanceUniform;
      vertexPars += 'attribute vec3 nightColor;\nvarying vec3 vNightColor;\n';
      vertexBody = vertexBody.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvNightColor = nightColor;',
      );
      fragmentPars += 'uniform float uDnBalance;\nvarying vec3 vNightColor;\n';
      fragmentBody = fragmentBody.replace(
        '#include <color_fragment>',
        '\tdiffuseColor.rgb *= mix( vColor, vNightColor, uDnBalance );',
      );
    }

    shader.vertexShader = vertexPars + vertexBody;
    shader.fragmentShader = fragmentPars + fragmentBody.replace('#include <opaque_fragment>', opaque);
  };

  return material;
}
