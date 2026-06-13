import { readFileSync } from 'node:fs';
import { Group, Matrix4, type ShaderMaterial } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RWBreakable } from '../parsers/binary/types';

import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import {
  buildDebrisMesh,
  DEBRIS_LIFETIME,
  debrisTimeUniform,
  resetDebris,
  spawnDebris,
  updateDebris,
} from './build-debris';
import { GLOW_LAYER } from './corona';

// The real LA trash bin shatter mesh (154 triangles, 7 identical-texture materials).
const BIN_DFF = 'tests/dff/breakable/binnt08_la.dff';

function binBreakable(): RWBreakable {
  const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(BIN_DFF))));
  const breakable = clump.geometries.find((geometry) => geometry.breakable)?.breakable;
  expect(breakable).toBeDefined();

  return breakable!;
}

/** A bin standing at (100, 200) on ground z = 10. */
const PLACEMENT = new Matrix4().makeTranslation(100, 200, 10);
const IMPACT = { groundZ: 10, seed: 7 };

describe('debris', () => {
  beforeEach(() => {
    resetDebris();
    debrisTimeUniform.value = 0;
  });

  describe('negative cases', () => {
    it('updateDebris with nothing active is a no-op', () => {
      expect(() => updateDebris(123)).not.toThrow();
      expect(debrisTimeUniform.value).toBe(123);
    });

    it('despawns a break after its lifetime (mesh detached + disposed)', () => {
      const parent = new Group();
      const mesh = spawnDebris(parent, binBreakable(), PLACEMENT, IMPACT);
      expect(mesh.parent).toBe(parent);
      updateDebris(DEBRIS_LIFETIME - 0.1);
      expect(mesh.parent).toBe(parent);
      updateDebris(DEBRIS_LIFETIME + 0.1);
      expect(mesh.parent).toBeNull();
    });

    it('expires the oldest break beyond the simultaneous budget', () => {
      const parent = new Group();
      const first = spawnDebris(parent, binBreakable(), PLACEMENT, IMPACT);
      for (let i = 0; i < 8; i += 1) {
        spawnDebris(parent, binBreakable(), PLACEMENT, { ...IMPACT, seed: 100 + i });
      }
      expect(first.parent).toBeNull(); // 9 spawns, budget 8 — the first one got evicted
      expect(parent.children).toHaveLength(8);
    });
  });

  describe('positive cases (real binnt08_la shatter mesh)', () => {
    it('builds per-triangle shards with flight attributes in world space', () => {
      const mesh = buildDebrisMesh(binBreakable(), PLACEMENT, IMPACT);

      // De-indexed: 3 unique vertices per shard triangle.
      const positions = mesh.geometry.getAttribute('position');
      expect(positions.count).toBe(154 * 3);
      for (const name of ['aCenter', 'aVelocity', 'aAngular', 'aLandTime', 'color', 'uv']) {
        expect(mesh.geometry.getAttribute(name).count).toBe(154 * 3);
      }

      // The bin's 7 materials share one texture — merged into a single draw group.
      expect(mesh.geometry.groups).toHaveLength(1);
      expect(Array.isArray(mesh.material) ? mesh.material : []).toHaveLength(1);
      const material = (mesh.material as ShaderMaterial[])[0];
      expect(material.transparent).toBe(true);
      expect(material.uniforms.uTime).toBe(debrisTimeUniform);
      // Out of the SSAO normal prepass (shader-animated — static rasterization would ghost).
      expect(mesh.layers.mask).toBe(1 << GLOW_LAYER);

      // World placement applied: every vertex sits around (100, 200, 10), bin-sized.
      for (let i = 0; i < positions.count; i += 1) {
        expect(Math.abs(positions.getX(i) - 100)).toBeLessThan(3);
        expect(Math.abs(positions.getY(i) - 200)).toBeLessThan(3);
        expect(Math.abs(positions.getZ(i) - 10)).toBeLessThan(3);
      }

      // Every shard pops upward and lands later (positive analytic landing time).
      const velocities = mesh.geometry.getAttribute('aVelocity');
      const landTimes = mesh.geometry.getAttribute('aLandTime');
      for (let i = 0; i < landTimes.count; i += 3) {
        expect(velocities.getZ(i)).toBeGreaterThan(0);
        expect(landTimes.getX(i)).toBeGreaterThan(0);
        expect(landTimes.getX(i)).toBeLessThan(DEBRIS_LIFETIME);
      }
    });

    it('never lands the shards when no ground plane is given (MVP sink)', () => {
      const mesh = buildDebrisMesh(binBreakable(), PLACEMENT, { seed: 7 });
      const landTimes = mesh.geometry.getAttribute('aLandTime');
      for (let i = 0; i < landTimes.count; i += 1) {
        expect(landTimes.getX(i)).toBeGreaterThan(DEBRIS_LIFETIME); // falls through for the whole life
      }
    });

    it('is deterministic for a fixed seed and varies across seeds', () => {
      const first = buildDebrisMesh(binBreakable(), PLACEMENT, IMPACT);
      const second = buildDebrisMesh(binBreakable(), PLACEMENT, IMPACT);
      const a = first.geometry.getAttribute('aVelocity').array;
      const b = second.geometry.getAttribute('aVelocity').array;
      expect(Array.from(b)).toEqual(Array.from(a));

      const other = buildDebrisMesh(binBreakable(), PLACEMENT, { ...IMPACT, seed: 8 });
      expect(Array.from(other.geometry.getAttribute('aVelocity').array)).not.toEqual(Array.from(a));
    });

    it('seeds the shard fling with the impact velocity', () => {
      const rammed = buildDebrisMesh(binBreakable(), PLACEMENT, { ...IMPACT, impact: [20, 0, 0] });
      const velocities = rammed.geometry.getAttribute('aVelocity');
      let sumX = 0;
      for (let i = 0; i < velocities.count; i += 3) {
        sumX += velocities.getX(i);
      }
      // The scatter is symmetric — the mean must carry the impact share (0.6 × 20 ± scatter).
      expect(sumX / (velocities.count / 3)).toBeGreaterThan(8);
    });
  });
});
