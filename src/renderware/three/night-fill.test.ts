import { MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';

import { applyNightFill, nightFillGround, nightFillRim, nightFillSky, nightFillUniform } from './night-fill';

interface FakeShader {
  fragmentShader: string;
  uniforms: Record<string, unknown>;
  vertexShader: string;
}

const fakeShader = (): FakeShader => ({
  fragmentShader: 'void main() {\n#include <emissivemap_fragment>\n}',
  uniforms: {},
  vertexShader: '',
});

/** Compile a material's onBeforeCompile against a fake shader (no GL needed) and return it. */
function compile(material: MeshStandardMaterial): FakeShader {
  const shader = fakeShader();
  material.onBeforeCompile(shader as never, undefined as never);

  return shader;
}

describe('applyNightFill', () => {
  describe('positive cases', () => {
    it('injects the night-fill uniforms (shared module-level references)', () => {
      const material = new MeshStandardMaterial();
      applyNightFill(material);
      const shader = compile(material);
      expect(shader.uniforms.uNightFill).toBe(nightFillUniform);
      expect(shader.uniforms.uFillSky).toBe(nightFillSky);
      expect(shader.uniforms.uFillGround).toBe(nightFillGround);
      expect(shader.uniforms.uFillRim).toBe(nightFillRim);
    });

    it('adds the fill term after the (preserved) emissivemap include and declares the uniforms', () => {
      const material = new MeshStandardMaterial();
      applyNightFill(material);
      const shader = compile(material);
      // The fill GLSL re-includes the emissive fragment, then adds the moonlight term after it.
      expect(shader.fragmentShader).toContain('#include <emissivemap_fragment>');
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance += nfMoon * diffuseColor.rgb');
      expect(shader.fragmentShader).toContain('uniform float uNightFill;');
    });

    it('appends a cache-key suffix so it never shares a fill-less cached program', () => {
      const plain = new MeshStandardMaterial().customProgramCacheKey();
      const material = new MeshStandardMaterial();
      applyNightFill(material);
      const key = material.customProgramCacheKey();
      expect(key.endsWith('|nightFill')).toBe(true);
      expect(key).not.toBe(plain); // distinct from a fill-less material's key
    });

    it('composes with an existing onBeforeCompile instead of clobbering it', () => {
      const material = new MeshStandardMaterial();
      let previousRan = false;
      material.onBeforeCompile = (shader): void => {
        previousRan = true;
        shader.uniforms.uReflect = { value: 1 };
      };
      applyNightFill(material);
      const shader = compile(material);
      expect(previousRan).toBe(true); // the prior compile still runs
      expect(shader.uniforms.uReflect).toEqual({ value: 1 }); // its work survives
      expect(shader.uniforms.uNightFill).toBe(nightFillUniform); // and the fill is layered on top
    });
  });
});
