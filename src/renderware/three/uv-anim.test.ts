import { readFileSync } from 'node:fs';
import { MeshBasicMaterial, Vector4 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RWUvAnimation } from '../parsers/binary/types';

import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildClumpParts } from './build-clump';
import {
  applyWorldUvAnim,
  getUvAnimUniform,
  registerUvAnimations,
  resetUvAnimations,
  updateUvAnimations,
} from './uv-anim';

const SIGN_DFF = 'tests/dff/uv-anim/visagesign04.dff';

/** uv params order: (rotation, scaleX, scaleY, skew, translateX, translateY). */
function scrollAnim(
  name: string,
  duration: number,
  keyframes: { time: number; tx: number; ty?: number }[],
): RWUvAnimation {
  return {
    duration,
    keyframes: keyframes.map((k) => ({ time: k.time, uv: [0, 1, 1, 0, k.tx, k.ty ?? 0] })),
    name,
  };
}

beforeEach(() => {
  resetUvAnimations();
});

describe('uv-anim registry', () => {
  describe('negative cases', () => {
    it('returns undefined for an unregistered animation name', () => {
      expect(getUvAnimUniform('nope')).toBeUndefined();
    });

    it('skips entries without keyframes', () => {
      registerUvAnimations([{ duration: 1, keyframes: [], name: 'empty' }]);
      expect(getUvAnimUniform('empty')).toBeUndefined();
    });

    it('updating an empty registry does not throw', () => {
      expect(() => updateUvAnimations(1.23)).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('interpolates a linear scroll between keyframes', () => {
      registerUvAnimations([
        scrollAnim('scroll', 3, [
          { time: 0, tx: 0 },
          { time: 3, tx: 1 },
        ]),
      ]);
      updateUvAnimations(1.5);
      const uniform = getUvAnimUniform('scroll');
      expect(uniform?.value.x).toBeCloseTo(0.5, 5); // offsetX
      expect(uniform?.value.y).toBeCloseTo(0, 5); // offsetY
      expect(uniform?.value.z).toBeCloseTo(1, 5); // scaleX
      expect(uniform?.value.w).toBeCloseTo(1, 5); // scaleY
    });

    it('loops over the duration', () => {
      registerUvAnimations([
        scrollAnim('loop', 3, [
          { time: 0, tx: 0 },
          { time: 3, tx: 1 },
        ]),
      ]);
      updateUvAnimations(4.5); // 4.5 % 3 = 1.5
      expect(getUvAnimUniform('loop')?.value.x).toBeCloseTo(0.5, 5);
    });

    it('snaps over equal-time keyframe pairs (stepped flipbook, e.g. DolSign)', () => {
      registerUvAnimations([
        scrollAnim('steps', 1, [
          { time: 0, tx: 0, ty: 0 },
          { time: 0.5, tx: 0, ty: 0 },
          { time: 0.5, tx: 0, ty: 0.5 },
          { time: 1, tx: 0, ty: 0.5 },
        ]),
      ]);
      updateUvAnimations(0.25);
      expect(getUvAnimUniform('steps')?.value.y).toBeCloseTo(0, 5); // first step holds
      updateUvAnimations(0.75);
      expect(getUvAnimUniform('steps')?.value.y).toBeCloseTo(0.5, 5); // jumped, no blend
    });

    it('re-registering the same name keeps the original uniform (idempotent across cell rebuilds)', () => {
      registerUvAnimations([
        scrollAnim('same', 3, [
          { time: 0, tx: 0 },
          { time: 3, tx: 1 },
        ]),
      ]);
      const first = getUvAnimUniform('same');
      registerUvAnimations([
        scrollAnim('same', 9, [
          { time: 0, tx: 0 },
          { time: 9, tx: 1 },
        ]),
      ]);
      expect(getUvAnimUniform('same')).toBe(first);
    });

    it('applyWorldUvAnim marks the program variant and injects the UV transform after uv_vertex', () => {
      const uniform = { value: new Vector4(0, 0, 1, 1) };
      const material = new MeshBasicMaterial();
      applyWorldUvAnim(material, uniform);
      expect(material.customProgramCacheKey()).toContain('|uvAnim');
      const shader = {
        fragmentShader: '#include <opaque_fragment>',
        uniforms: {},
        vertexShader: '#include <uv_vertex>\n#include <project_vertex>',
      } as unknown as Parameters<MeshBasicMaterial['onBeforeCompile']>[0];
      material.onBeforeCompile(shader, undefined as never);
      expect(shader.uniforms.uUvAnim).toBe(uniform);
      expect(shader.vertexShader).toContain('uniform vec4 uUvAnim;');
      expect(shader.vertexShader).toContain('vMapUv = vMapUv * uUvAnim.zw + uUvAnim.xy');
      const anchor = shader.vertexShader.indexOf('#include <uv_vertex>');
      const inject = shader.vertexShader.indexOf('vMapUv = vMapUv');
      expect(inject).toBeGreaterThan(anchor); // applied AFTER the stock map UV transform
    });
  });
});

describe('buildClumpParts + visagesign04 (real asset)', () => {
  describe('positive cases', () => {
    it('registers the dict and applies the uvAnim variant to plugin-carrying materials', () => {
      const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(SIGN_DFF))));
      const parts = buildClumpParts(clump);
      expect(getUvAnimUniform('DolSign')).toBeDefined();
      const animated = parts.filter((part) => part.material.customProgramCacheKey().includes('|uvAnim'));
      expect(animated.length).toBeGreaterThanOrEqual(2);
      const still = parts.filter((part) => !part.material.customProgramCacheKey().includes('|uvAnim'));
      expect(still.length).toBeGreaterThan(0); // the sign's frame/posts stay static
    });
  });
});
