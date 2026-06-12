import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toArrayBuffer } from '../../test-utils';
import { parseDff } from './dff';
import { parseIfp } from './ifp';

// Real animated-map-object assets (plan 041): the Visage skull sign (UV-animated textures via a
// leading UVAnimDict + per-material 0x135 plugin) and the oil-field nodding donkey (a multi-frame
// clump whose looping clip lives in counxref.ifp, bound by DFF frame names).
const SIGN_DFF = 'tests/dff/uv-anim/visagesign04.dff';
const PUMP_DFF = 'tests/dff/anim-clump/nt_noddonkbase.dff';
const PUMP_IFP = 'tests/dff/anim-clump/counxref.ifp';

function load(path: string): ArrayBuffer {
  return toArrayBuffer(new Uint8Array(readFileSync(path)));
}

describe('UV-animated DFFs (visagesign04)', () => {
  describe('negative cases', () => {
    it('leaves clumps without a UVAnimDict untouched', () => {
      const clump = parseDff(load(PUMP_DFF));
      expect(clump.uvAnimations).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('parses the UVAnimDict: 3 animations with names, durations and keyframes', () => {
      const clump = parseDff(load(SIGN_DFF));
      expect(clump.uvAnimations).toHaveLength(3);
      // Per-entry shape verified byte-by-byte: two 3 s 2-keyframe scrolls + a 1 s 5-keyframe flipbook.
      const byName = new Map(clump.uvAnimations?.map((animation) => [animation.name, animation]));
      expect([...byName.keys()].sort()).toEqual(['DolSign', 'Material #2065564020', 'Money']);
      expect(byName.get('Material #2065564020')?.duration).toBeCloseTo(3, 5);
      expect(byName.get('Material #2065564020')?.keyframes).toHaveLength(2);
      expect(byName.get('Money')?.duration).toBeCloseTo(3, 5);
      expect(byName.get('Money')?.keyframes).toHaveLength(2);
      expect(byName.get('DolSign')?.duration).toBeCloseTo(1, 5);
      expect(byName.get('DolSign')?.keyframes).toHaveLength(5);
      for (const animation of clump.uvAnimations ?? []) {
        const last = animation.keyframes[animation.keyframes.length - 1];
        expect(animation.keyframes[0].time).toBeCloseTo(0, 5);
        expect(last.time).toBeCloseTo(animation.duration, 5);
      }
    });

    it('decodes the keyframe UV params — a horizontal scroll (translateX 0 → 1 over 3 s)', () => {
      const clump = parseDff(load(SIGN_DFF));
      const scroll = clump.uvAnimations?.find((animation) => animation.name === 'Material #2065564020');
      expect(scroll).toBeDefined();
      expect(scroll?.keyframes[0].uv[4]).toBeCloseTo(0, 5); // translateX at t=0
      expect(scroll?.keyframes[1].uv[4]).toBeCloseTo(1, 5); // translateX at t=duration
      expect(scroll?.keyframes[0].uv[1]).toBeCloseTo(1, 5); // scaleX stays 1
      expect(scroll?.keyframes[0].uv[2]).toBeCloseTo(1, 5); // scaleY stays 1
    });

    it('links materials to dict entries via the 0x135 plugin', () => {
      const clump = parseDff(load(SIGN_DFF));
      const animated = clump.geometries
        .flatMap((geometry) => geometry.materials)
        .filter((material) => material.effects?.uvAnim);
      expect(animated.length).toBeGreaterThanOrEqual(2);
      const names = animated.flatMap((material) => material.effects?.uvAnim?.names ?? []);
      expect(names).toContain('DolSign');
      const dictNames = new Set(clump.uvAnimations?.map((animation) => animation.name));
      for (const name of names) {
        expect(dictNames.has(name)).toBe(true); // every referenced anim exists in the dict
      }
    });
  });
});

describe('IFP-animated clump (nt_noddonkbase + counxref.ifp)', () => {
  describe('positive cases', () => {
    it('the pump DFF is a multi-frame hierarchy (the nodding arm needs its frames)', () => {
      const clump = parseDff(load(PUMP_DFF));
      expect(clump.frames.length).toBe(6);
      expect(clump.atomics.length).toBe(5);
    });

    it('counxref.ifp carries a clip whose bones bind to the pump frame names', () => {
      const clump = parseDff(load(PUMP_DFF));
      const animations = parseIfp(load(PUMP_IFP));
      expect(animations.length).toBeGreaterThan(0);
      const frameNames = new Set(clump.frames.map((frame) => frame.name.toLowerCase()));
      // At least one IFP animation must target this model's frames — that's the binding SA uses.
      const matching = animations.filter((animation) =>
        animation.bones.some((bone) => frameNames.has(bone.name.trim().toLowerCase())),
      );
      expect(matching.length).toBeGreaterThan(0);
    });
  });
});
