import { describe, expect, it } from 'vitest';

import { parseParkedVehicles } from './parked-vehicles';

const VALID = JSON.stringify([
  { colour: '57,57', heading: 0, model: 'admiral', position: [2502, -1678, 13.4] },
  { heading: 90, model: 'comet', position: [2493, -1678, 13.4] }, // colour optional
]);

describe('parseParkedVehicles', () => {
  describe('negative cases', () => {
    it('returns [] for an absent file (null)', () => {
      expect(parseParkedVehicles(null)).toEqual([]);
    });

    it('returns [] for malformed JSON', () => {
      expect(parseParkedVehicles('{not json')).toEqual([]);
    });

    it('drops entries missing required fields (model/heading/position)', () => {
      const text = JSON.stringify([
        { heading: 0, position: [1, 2, 3] }, // no model
        { model: 'x', position: [1, 2, 3] }, // no heading
        { heading: 0, model: 'x', position: [1, 2] }, // bad position
      ]);
      expect(parseParkedVehicles(text)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses valid placements, keeping optional colour', () => {
      expect(parseParkedVehicles(VALID)).toEqual([
        { colour: '57,57', heading: 0, model: 'admiral', position: [2502, -1678, 13.4] },
        { heading: 90, model: 'comet', position: [2493, -1678, 13.4] },
      ]);
    });
  });
});
