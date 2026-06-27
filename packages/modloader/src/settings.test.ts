import { describe, expect, it } from 'vitest';

import { parseVehicleSettings } from './settings';

const IDE = '416, ambulan, ambulan, car, AMBULAN, AMBULAN, van, ignore, 10, 0, 0, -1, 0.82, 0.82, -1';
const HANDLING =
  'AMBULAN  3500.0 14000.0 4.0 0.0 0.0 0.1 80 0.55 0.85 0.46 5 145.0 R D 4.5 0.6 0 30 2 0.07 5 0.3 -0.15 0.5 0 0.58 0.33 10000 4001 4 0 1 13';
const CARCOLS = 'ambulan, 1,3';

describe('parseVehicleSettings', () => {
  describe('negative cases', () => {
    it('drops blocks that no parser recognises', () => {
      expect(parseVehicleSettings('not a real settings line at all')).toEqual({});
    });

    it('returns an empty object for empty text', () => {
      expect(parseVehicleSettings('')).toEqual({});
    });
  });

  describe('positive cases', () => {
    it('classifies the three blocks of a full settings file', () => {
      const result = parseVehicleSettings(`${IDE}\n\n${HANDLING}\n\n${CARCOLS}\n`);

      expect(result.ideLine).toBe(IDE);
      expect(result.handlingLine).toBe(HANDLING);
      expect(result.carcolsLine).toBe(CARCOLS);
    });

    it('handles a partial file (only handling present)', () => {
      const result = parseVehicleSettings(HANDLING);

      expect(result).toEqual({ handlingLine: HANDLING });
    });

    it('distinguishes an ide line (numeric id) from a carcols line (model name)', () => {
      expect(parseVehicleSettings(IDE).ideLine).toBe(IDE);
      expect(parseVehicleSettings(CARCOLS).carcolsLine).toBe(CARCOLS);
    });
  });
});
