import type { CarGroup, IplCarGenerator, PopcycleZone } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { positionSeed, randomCarModel, randomCarPlacements } from './popcycle-cars';

/** cargrp with 18 POPCYCLE_GROUP_* groups; group 1 (Business) = [premier, elegant], group 10 (Criminals) = [manana]. */
function cargrp(): CarGroup[] {
  const names = [
    'WORKERS',
    'BUSINESS',
    'CLUBBERS',
    'FARMERS',
    'BEACHFOLK',
    'PARKFOLK',
    'CASUAL_RICH',
    'CASUAL_AVERAGE',
    'CASUAL_POOR',
    'PROSTITUTES',
    'CRIMINALS',
    'GOLFERS',
    'SERVANTS',
    'AIRCREW',
    'ENTERTAINERS',
    'OUT_OF_TOWN_FACTORY',
    'DESERT_FOLK',
    'AIRCREW_RUNWAY',
  ];

  return names.map((name, i) => ({
    comment: `POPCYCLE_GROUP_${name}`,
    models: i === 1 ? ['premier', 'elegant'] : i === 10 ? ['manana'] : [`car${i}`],
  }));
}

/** A zone whose weekday midnight slot weights only one group (index `g`). */
function zoneWeighting(g: number): PopcycleZone {
  const weights = Array.from({ length: 18 }, (_, i) => (i === g ? 100 : 0));
  const slot = { groupWeights: weights, maxCars: 10 };
  const empty = { groupWeights: Array.from({ length: 18 }, () => 0), maxCars: 0 };

  return { weekday: [slot], weekend: [empty] };
}

describe('randomCarModel', () => {
  describe('negative cases', () => {
    it('returns null when the slot has no weighted group', () => {
      const zone: PopcycleZone = {
        weekday: [{ groupWeights: Array.from({ length: 18 }, () => 0), maxCars: 0 }],
        weekend: [],
      };
      expect(randomCarModel({ cargrp: cargrp(), hour: 0, popcycle: zone, seed: 1, weekend: false })).toBeNull();
    });

    it('returns null when the chosen group has no accepted model', () => {
      const out = randomCarModel({
        accept: () => false, // reject everything
        cargrp: cargrp(),
        hour: 0,
        popcycle: zoneWeighting(1),
        seed: 1,
        weekend: false,
      });
      expect(out).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('picks a model from the weighted group (Business → premier/elegant)', () => {
      const out = randomCarModel({ cargrp: cargrp(), hour: 0, popcycle: zoneWeighting(1), seed: 7, weekend: false });
      expect(['premier', 'elegant']).toContain(out);
    });

    it('is deterministic for a given seed', () => {
      const q = { cargrp: cargrp(), hour: 0, popcycle: zoneWeighting(1), seed: 42, weekend: false };
      expect(randomCarModel(q)).toBe(randomCarModel(q));
    });

    it('honours the accept gate (only elegant allowed)', () => {
      const out = randomCarModel({
        accept: (m) => m === 'elegant',
        cargrp: cargrp(),
        hour: 0,
        popcycle: zoneWeighting(1),
        seed: 3,
        weekend: false,
      });
      expect(out).toBe('elegant');
    });

    it('selects the criminals group at gangland midnight (index 10 → manana)', () => {
      const out = randomCarModel({ cargrp: cargrp(), hour: 1, popcycle: zoneWeighting(10), seed: 5, weekend: false });
      expect(out).toBe('manana');
    });
  });
});

function carGenerator(partial: Partial<IplCarGenerator>): IplCarGenerator {
  return {
    alarm: 0,
    angle: 0,
    doorLock: 0,
    forceSpawn: 0,
    id: -1,
    position: [0, 0, 0],
    primaryColor: -1,
    secondaryColor: -1,
    ...partial,
  };
}

describe('positionSeed', () => {
  describe('positive cases', () => {
    it('is stable for the same position and differs for distinct ones', () => {
      expect(positionSeed([10, 20, 3])).toBe(positionSeed([10, 20, 3]));
      expect(positionSeed([10, 20, 3])).not.toBe(positionSeed([11, 20, 3]));
    });
  });
});

describe('randomCarPlacements', () => {
  describe('negative cases', () => {
    it('ignores specific-model generators (only resolves id = -1)', () => {
      const out = randomCarPlacements([carGenerator({ id: 452 })], {
        accept: () => true,
        cargrp: cargrp(),
        hour: 0,
        popcycleFor: () => zoneWeighting(1),
      });
      expect(out).toEqual([]);
    });

    it('skips a generator whose position has no resolvable zone-type', () => {
      const out = randomCarPlacements([carGenerator({})], {
        accept: () => true,
        cargrp: cargrp(),
        hour: 0,
        popcycleFor: () => null, // unknown zone-type
      });
      expect(out).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('resolves a random generator to a placement (heading from angle, model from the weighted group)', () => {
      const out = randomCarPlacements([carGenerator({ angle: 1.5, position: [10, 20, 3] })], {
        accept: () => true,
        cargrp: cargrp(),
        hour: 0,
        popcycleFor: () => zoneWeighting(1), // Business → premier/elegant
      });

      expect(out).toHaveLength(1);
      expect(out[0].heading).toBe(1.5);
      expect(out[0].position).toEqual([10, 20, 3]);
      expect(out[0].groundSnap).toBe(true); // map cars ground-snap on spawn (plan 059)
      expect(['premier', 'elegant']).toContain(out[0].model);
    });
  });
});
