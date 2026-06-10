import { describe, expect, it } from 'vitest';

import type { CityBox } from './city';

import { cityAt, cityFromLevel, isDesertZone } from './city';

// The real map.zon city boxes (level → city: 1 LA, 2 SF, 3 Vegas).
const BOXES: CityBox[] = [
  { city: 'VEGAS', max: [3000, 3000], min: [685, 476.093] },
  { city: 'SF', max: [-1270.53, 1530.24], min: [-3000, -742.306] },
  { city: 'LA', max: [3000, -850], min: [480, -3000] },
];
// Desert county boxes (Bone County + Tierra Robada), placed FIRST so they win over the coarse Vegas box.
const DESERT_BOXES: CityBox[] = [
  { city: 'DESERT', max: [869, 2994], min: [-481, 596] }, // BONE
  { city: 'DESERT', max: [-481, 2994], min: [-2997, 1660] }, // ROBAD
];

describe('isDesertZone', () => {
  describe('negative cases', () => {
    it('is false for non-desert zone names', () => {
      expect(isDesertZone('GANTON')).toBe(false);
      expect(isDesertZone('VE')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('is true for the BONE / ROBAD county zones (case-insensitive)', () => {
      expect([isDesertZone('BONE'), isDesertZone('robad')]).toEqual([true, true]);
    });
  });
});

describe('cityFromLevel', () => {
  describe('negative cases', () => {
    it('is null for an unknown level', () => {
      expect(cityFromLevel(0)).toBeNull();
      expect(cityFromLevel(9)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('maps 1/2/3 → LA/SF/VEGAS', () => {
      expect([cityFromLevel(1), cityFromLevel(2), cityFromLevel(3)]).toEqual(['LA', 'SF', 'VEGAS']);
    });
  });
});

describe('cityAt', () => {
  describe('negative cases', () => {
    it('is Countryside outside every city box', () => {
      expect(cityAt(0, 0, BOXES)).toBe('COUNTRYSIDE');
    });

    it('is Countryside with no boxes loaded', () => {
      expect(cityAt(2502, -1714, [])).toBe('COUNTRYSIDE');
    });
  });

  describe('positive cases', () => {
    it('classifies the Ganton spawn as Los Santos', () => {
      expect(cityAt(2502, -1714, BOXES)).toBe('LA');
    });

    it('classifies San Fierro and Las Venturas points', () => {
      expect(cityAt(-2000, 500, BOXES)).toBe('SF');
      expect(cityAt(2000, 2000, BOXES)).toBe('VEGAS');
    });

    it('classifies Bone County / Tierra Robada as Desert (desert boxes checked first)', () => {
      const ordered = [...DESERT_BOXES, ...BOXES];
      expect(cityAt(0, 1500, ordered)).toBe('DESERT'); // central Bone County
      expect(cityAt(-1500, 2000, ordered)).toBe('DESERT'); // Tierra Robada
      expect(cityAt(750, 1500, ordered)).toBe('DESERT'); // overlap strip — desert wins over the coarse Vegas box
      expect(cityAt(2000, 2000, ordered)).toBe('VEGAS'); // real Las Venturas (east of Bone County)
    });
  });
});
