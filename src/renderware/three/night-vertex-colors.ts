import type { MeshStandardMaterial } from 'three';

/**
 * Night factor (0 day → 1 night) shared by every night-vertex-colour building material. The game drives it
 * each frame (like the corona/light-pool uniforms); at 0 the buildings render as plain day, at 1 their baked
 * **night vertex colours** glow — SA's lit windows.
 */
export const nightColorUniform = { value: 0 };

/**
 * Light a textured map material by its geometry's **night vertex colours** at night — SA's whole baked night
 * lighting, not just windows. The night set IS the night lighting: dark where unlit, **warm where a street
 * lamp's pool is baked onto the road/ground**, bright at lit windows/signs. We add **`texture × nightColour`**
 * (the SA `texture × night-prelit` term) as emissive, so it takes the texture's shape (window panes, neon
 * letters, the road's lamp pools) and is **not gated** — the moderate warm road/wall texels are exactly the
 * baked ambient/lamp light, so they must show. The flat night `ambient` is kept low (see config) so these
 * baked colours give the variation instead of a flat wash; this also replaces the projected light pools.
 * Scaled by {@link nightColorUniform} (0 by day → daytime unchanged). One shared program via the cache key.
 */
export function applyNightVertexEmissive(material: MeshStandardMaterial): void {
  material.customProgramCacheKey = (): string => 'nightVertexColor';
  material.onBeforeCompile = (shader): void => {
    shader.uniforms.uNightColor = nightColorUniform;
    shader.vertexShader =
      'attribute vec3 nightColor;\nvarying vec3 vNightColor;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvNightColor = nightColor;');
    shader.fragmentShader =
      'uniform float uNightColor;\nvarying vec3 vNightColor;\n' +
      shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += texture2D(map, vMapUv).rgb * vNightColor * uNightColor;',
      );
  };
}
