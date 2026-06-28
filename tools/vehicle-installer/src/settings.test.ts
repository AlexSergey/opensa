import { describe, expect, it } from 'vitest';

import { parseVehicleSettings } from './settings';

const IDE = '602, alpha, alpha, car, ALPHA, ALPHA, null, richfamily, 10, 0, 0, -1, 0.725, 0.725, 1';
const HANDLING =
  'ALPHA 1722.0 5000.0 2.4 0.0 0.08 -0.2 75 0.72 0.72 0.5 5 210.4 24.0 30.0 4 P 4.3 0.56 1 30.0 ' +
  '0.61 0.12 0.5 0.11 -0.06 0.49 0.12 0.10 0.50 35000 C0222000 0540000E 1 1 1';
const CARCOLS = 'alpha, 0,102, 79,25, 51,104';
const CARMODS = 'alpha, nto_b_l, nto_b_s, nto_b_tw';
const PALETTE = ['233,199,40   # new1 yellow taxi cab   yellow', '186,208,125  # new2 light green cab   green'].join(
  '\n',
);
const CARCOLS_REFS = 'cabbie, 6,0,6,0, new2,0,new2,0, new1,0,new1,0';

describe('parseVehicleSettings', () => {
  describe('negative cases', () => {
    it('returns an empty object for blank text', () => {
      expect(parseVehicleSettings('')).toEqual({});
    });

    it('drops a block no parser recognises (prose)', () => {
      expect(parseVehicleSettings('the uphill gardener, by mad driver')).toEqual({});
    });
  });

  describe('positive cases', () => {
    it('classifies all four blocks of a full settings file', () => {
      expect(parseVehicleSettings([IDE, HANDLING, CARCOLS, CARMODS].join('\n\n'))).toEqual({
        carcolsLine: CARCOLS,
        carmodsLine: CARMODS,
        handlingLine: HANDLING,
        ideLine: IDE,
      });
    });

    it('splits two name-leading blocks by their values: numeric → carcols, part ids → carmods', () => {
      const result = parseVehicleSettings([CARCOLS, CARMODS].join('\n\n'));
      expect(result.carcolsLine).toBe(CARCOLS);
      expect(result.carmodsLine).toBe(CARMODS);
      expect(result.ideLine).toBeUndefined();
      expect(result.handlingLine).toBeUndefined();
    });

    it('handles a partial file (only the carmods block present)', () => {
      expect(parseVehicleSettings(CARMODS)).toEqual({ carmodsLine: CARMODS });
    });

    it('collects a palette block and keeps a carcols line that references newN', () => {
      const result = parseVehicleSettings([PALETTE, CARCOLS_REFS].join('\n\n'));
      expect(result.palette).toEqual([
        { line: '233,199,40   # new1 yellow taxi cab   yellow', name: 'new1' },
        { line: '186,208,125  # new2 light green cab   green', name: 'new2' },
      ]);
      expect(result.carcolsLine).toBe(CARCOLS_REFS); // not mis-classified as carmods despite the `newN` cells
    });
  });
});
