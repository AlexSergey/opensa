import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parsePopcycle, popcycleSlotForHour } from './popcycle.parser';

/** A tiny two-zone popcycle in the real layout: `// NAME` between `////` separators, Weekday/Weekend rows. */
const SYNTHETIC = [
  '////////////////',
  '// BUSINESS',
  '////////////////',
  '// Weekday',
  '//',
  '// #Peds #Cars Dealers Gang Cops Other  Workers Business ...',
  '  3  9  100 100 100 100   0 50 0 0 0 0 0 0 50 0 0 0 0 0 0 0 0 0  // Midnight',
  '  5  12 100 100 100 100   0 80 0 0 0 0 0 20 0 0 0 0 0 0 0 0 0 0  // 2am',
  '////////////////',
  '// Weekend',
  '//',
  '  4  10 100 100 100 100   0 60 0 0 0 0 0 40 0 0 0 0 0 0 0 0 0 0  // Midnight',
  '////////////////',
  '// GANGLAND',
  '////////////////',
  '// Weekday',
  '  2  6  100 100 100 100   0 0 0 0 0 0 0 0 0 0 100 0 0 0 0 0 0 0  // Midnight',
].join('\n');

const realPath = join(process.cwd(), 'tests', 'original', 'data', 'popcycle.dat');

describe('popcycleSlotForHour', () => {
  describe('positive cases', () => {
    it('maps a game hour to its 2-hour slot', () => {
      expect(popcycleSlotForHour(0)).toBe(0); // midnight
      expect(popcycleSlotForHour(1)).toBe(0);
      expect(popcycleSlotForHour(2)).toBe(1); // 2am
      expect(popcycleSlotForHour(23)).toBe(11); // 10pm slot
      expect(popcycleSlotForHour(24)).toBe(0); // wraps
    });
  });
});

describe('parsePopcycle', () => {
  describe('negative cases', () => {
    it('returns an empty map for text with no zone blocks', () => {
      expect(parsePopcycle('// just a comment\nnot data').size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('parses zone-type blocks with weekday/weekend slots, keeping #Cars + the 18 group weights', () => {
      const zones = parsePopcycle(SYNTHETIC);

      expect([...zones.keys()]).toEqual(['BUSINESS', 'GANGLAND']);
      const business = zones.get('BUSINESS')!;
      expect(business.weekday).toHaveLength(2);
      expect(business.weekend).toHaveLength(1);
      expect(business.weekday[0].maxCars).toBe(9);
      expect(business.weekday[0].groupWeights).toHaveLength(18);
      expect(business.weekday[0].groupWeights[1]).toBe(50); // Business column
      expect(business.weekday[0].groupWeights[8]).toBe(50); // Casual_Poor column
      // GANGLAND weights the Criminals group (index 10).
      expect(zones.get('GANGLAND')!.weekday[0].groupWeights[10]).toBe(100);
    });
  });

  describe.skipIf(!existsSync(realPath))('real popcycle.dat fixture', () => {
    it('parses all 20 zone-types with 12 weekday + 12 weekend slots each', () => {
      const zones = parsePopcycle(readFileSync(realPath, 'utf8'));

      expect(zones.size).toBe(20);
      expect(zones.has('BUSINESS')).toBe(true);
      expect(zones.has('INDUSTRY')).toBe(true);
      for (const zone of zones.values()) {
        expect(zone.weekday).toHaveLength(12);
        expect(zone.weekend).toHaveLength(12);
        expect(zone.weekday[0].groupWeights).toHaveLength(18);
      }
    });
  });
});
