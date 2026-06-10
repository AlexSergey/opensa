import type { MeshBasicMaterial } from 'three';

import { describe, expect, it } from 'vitest';

import type { IdeObjectDef, RenderPart } from '../../renderware';

import { buildWorldMaterial, IdeFlag } from '../../renderware';
import { createWindMod } from './wind.mod';

/** The onBeforeCompile parameter type (three renamed the old `Shader` type). */
type CompileShader = Parameters<MeshBasicMaterial['onBeforeCompile']>[0];

function def(modelName: string, flags = 0): IdeObjectDef {
  return { drawDistance: 100, flags, id: 1, modelName, txdName: 'txd' };
}

function part(swayAlphaMin?: number): RenderPart {
  const geometry = {
    flags: 0,
    lights: [],
    materials: [],
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array(9),
    prelitColors: null,
    triangles: [],
    uvLayers: [],
  };

  return {
    geometry: undefined as never, // the mod only touches the material
    material: buildWorldMaterial({ color: [255, 255, 255, 255], texture: null, textured: false }, geometry),
    matrix: undefined as never,
    ...(swayAlphaMin === undefined ? {} : { swayAlphaMin }),
  };
}

/** Minimal shader stub holding the three.js chunk anchors the injections wrap around. */
function shaderStub(): CompileShader {
  return {
    fragmentShader: '#include <color_fragment>\n#include <opaque_fragment>',
    uniforms: {},
    vertexShader: '#include <begin_vertex>\n#include <project_vertex>',
  } as unknown as CompileShader;
}

const mod = createWindMod();

describe('wind mod', () => {
  describe('negative cases', () => {
    it('leaves unlisted, unflagged models untouched', () => {
      const target = part();
      mod.decoratePart?.(def('some_building'), target);
      expect(target.material.customProgramCacheKey()).toBe('saWorld');
    });

    it('does NOT sway on prelit alphas alone (roads/night overlays use them too)', () => {
      const target = part(229); // a vegasnroad-style blend edge
      mod.decoratePart?.(def('vegasnroad25'), target);
      expect(target.material.customProgramCacheKey()).toBe('saWorld');
    });
  });

  describe('positive cases', () => {
    it('sways listed models — weight mode when the asset is wind-adapted', () => {
      const target = part(170); // cedar-style canopy alphas
      mod.decoratePart?.(def('cedar1_hi'), target);
      expect(target.material.customProgramCacheKey()).toBe('saWorld|sway-tree-weight');
      const shader = shaderStub();
      target.material.onBeforeCompile(shader, undefined as never);
      expect(shader.vertexShader).toContain('attribute float swayWeight');
      expect(shader.vertexShader).toContain('instanceMatrix[ 3 ]'); // per-instance phase
      // Sway runs before the world material's shadow projection so received shadows follow it.
      const swayAt = shader.vertexShader.indexOf('transformed.x +=');
      const shadowAt = shader.vertexShader.indexOf('vWorldShadowCoord = uWorldShadowMatrix');
      expect(swayAt).toBeGreaterThan(-1);
      expect(shadowAt).toBeGreaterThan(-1);
      expect(swayAt).toBeLessThan(shadowAt);
    });

    it('falls back to height mode for listed models without adapted alphas (cacti)', () => {
      const target = part();
      mod.decoratePart?.(def('sjmcacti1'), target);
      expect(target.material.customProgramCacheKey()).toBe('saWorld|sway-tree-height');
      const shader = shaderStub();
      target.material.onBeforeCompile(shader, undefined as never);
      expect(shader.vertexShader).toContain('max( transformed.z, 0.0 )');
    });

    it('IDE veg flags trigger sway too, with the palm tuning for IS_PALM', () => {
      const tree = part();
      mod.decoratePart?.(def('whatever', IdeFlag.IS_TREE), tree);
      expect(tree.material.customProgramCacheKey()).toBe('saWorld|sway-tree-height');
      const palm = part();
      mod.decoratePart?.(def('whatever', IdeFlag.IS_PALM), palm);
      expect(palm.material.customProgramCacheKey()).toBe('saWorld|sway-palm-height');
    });

    it('listed palm-named models get the palm tuning', () => {
      const target = part(170);
      mod.decoratePart?.(def('vgs_palm01'), target);
      expect(target.material.customProgramCacheKey()).toBe('saWorld|sway-palm-weight');
    });

    it('update drives the shared wind clock into the shader uniform', () => {
      const target = part(170);
      mod.decoratePart?.(def('cedar1_hi'), target);
      const shader = shaderStub();
      target.material.onBeforeCompile(shader, undefined as never);
      mod.update?.({ hours: 12, seconds: 42 });
      expect((shader.uniforms.uWindTime as { value: number }).value).toBe(42);
    });
  });
});
