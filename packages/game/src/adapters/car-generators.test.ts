import type { IplCarGenerator } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { carGeneratorPlacements } from './car-generators';

const MODELS = new Map<number, string>([
  [400, 'landstal'],
  [452, 'rancher'],
]);

function gen(partial: Partial<IplCarGenerator>): IplCarGenerator {
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

describe('carGeneratorPlacements', () => {
  describe('negative cases', () => {
    it('skips random generators (id = -1)', () => {
      expect(carGeneratorPlacements([gen({ id: -1 })], MODELS)).toEqual([]);
    });

    it('skips ids with no vehicle definition', () => {
      expect(carGeneratorPlacements([gen({ id: 999 })], MODELS)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('resolves id→model, heading from the angle, and colour from prim/sec', () => {
      const out = carGeneratorPlacements(
        [gen({ angle: Math.PI, id: 452, position: [10, 20, 3], primaryColor: 6, secondaryColor: 1 })],
        MODELS,
      );

      expect(out).toEqual([
        { colour: '6,1', groundSnap: true, heading: Math.PI, model: 'rancher', position: [10, 20, 3] },
      ]);
    });

    it('omits colour when either channel is random (-1)', () => {
      const [placement] = carGeneratorPlacements([gen({ id: 400, primaryColor: 6, secondaryColor: -1 })], MODELS);

      expect(placement.model).toBe('landstal');
      expect(placement.colour).toBeUndefined();
    });
  });
});
