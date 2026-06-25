import { Points } from 'three';
import { describe, expect, it } from 'vitest';

import type { CoronaEntry } from './corona';

import { buildCoronaPoints, coronaMaterial, GLOW_LAYER } from './corona';

const entry = (overrides: Partial<CoronaEntry> = {}): CoronaEntry => ({
  color: [255, 128, 0],
  farClip: 120,
  position: [10, 20, 30],
  size: 1.5,
  ...overrides,
});

describe('buildCoronaPoints', () => {
  describe('negative cases', () => {
    it('returns null when there are no coronas', () => {
      expect(buildCoronaPoints([])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('builds a Points cloud on the glow layer using the shared corona material', () => {
      const points = buildCoronaPoints([entry()]);
      expect(points).toBeInstanceOf(Points);
      expect(points!.material).toBe(coronaMaterial);
      expect(points!.name).toBe('Coronas');
      expect(points!.renderOrder).toBe(2);
      // Only the glow layer is enabled (excluded from the AO normal prepass) — the default layer 0 is off.
      expect(points!.layers.mask).toBe(1 << GLOW_LAYER);
    });

    it('packs position/size/far verbatim and normalises colour to 0..1', () => {
      const points = buildCoronaPoints([entry({ color: [255, 0, 51], farClip: 80, position: [1, 2, 3], size: 2 })])!;
      const geometry = points.geometry;
      expect(Array.from(geometry.getAttribute('position').array)).toEqual([1, 2, 3]);
      expect(Array.from(geometry.getAttribute('aSize').array)).toEqual([2]);
      expect(Array.from(geometry.getAttribute('aFar').array)).toEqual([80]);
      const color = Array.from(geometry.getAttribute('aColor').array);
      expect(color[0]).toBeCloseTo(1, 6);
      expect(color[1]).toBeCloseTo(0, 6);
      expect(color[2]).toBeCloseTo(51 / 255, 6);
    });

    it('packs every entry and computes a bounding sphere', () => {
      const points = buildCoronaPoints([entry({ position: [0, 0, 0] }), entry({ position: [100, 0, 0] })])!;
      expect(points.geometry.getAttribute('position').count).toBe(2);
      expect(points.geometry.boundingSphere).not.toBeNull();
      expect(points.geometry.boundingSphere!.radius).toBeGreaterThan(0);
    });
  });
});
