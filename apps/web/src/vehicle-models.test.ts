import { describe, expect, it } from 'vitest';

import { vehicleModelsFromIde } from './vehicle-models';

const fs = (text: null | string): { getText: () => null | string } => ({ getText: () => text });

const IDE = `cars
400, landstal, landstal, car, LANDSTAL, LANDSTAL, x, ignore, 7, 0, 0, -1, 0.8, 0.8, -1
402, Buffalo, buffalo, car, BUFFALO, BUFFALO, x, ignore, 7, 0, 0, -1, 0.7, 0.7, -1
end`;

describe('vehicleModelsFromIde', () => {
  describe('negative cases', () => {
    it('returns empty when vehicles.ide is absent', () => {
      expect(vehicleModelsFromIde(fs(null))).toEqual([]);
    });

    it('returns empty for a vehicles.ide with no cars', () => {
      expect(vehicleModelsFromIde(fs('cars\nend'))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('lists every cars-section model, lowercased and sorted', () => {
      expect(vehicleModelsFromIde(fs(IDE))).toEqual(['buffalo', 'landstal']);
    });
  });
});
