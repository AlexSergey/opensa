import { describe, expect, it } from 'vitest';

import { vehicleModelsFromNames } from './vehicle-models';

describe('vehicleModelsFromNames', () => {
  describe('negative cases', () => {
    it('returns empty when no vehicles/*.dff are present', () => {
      expect(vehicleModelsFromNames(['data/gta.dat', 'vehicles/admiral.txd', 'models/wheel.dff'])).toEqual([]);
    });

    it('returns empty for an empty list', () => {
      expect(vehicleModelsFromNames([])).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('extracts dff basenames under vehicles/, sorted, ignoring txd and other paths', () => {
      const names = ['vehicles/sultan.dff', 'vehicles/admiral.dff', 'vehicles/admiral.txd', 'data/gta.dat'];
      expect(vehicleModelsFromNames(names)).toEqual(['admiral', 'sultan']);
    });

    it('lowercases and dedupes', () => {
      expect(vehicleModelsFromNames(['vehicles/Cheetah.dff', 'vehicles/cheetah.dff'])).toEqual(['cheetah']);
    });
  });
});
