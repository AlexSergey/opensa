import { describe, expect, it } from 'vitest';

import { parsePedSettings } from './settings';

const PEDS_LINE =
  '280, cesar, cesar, CIVMALE, STAT_GANG1, gang1, 0, 0, null, 5,7, PED_TYPE_GANG, VOICE_GANG, VOICE_GANG';

describe('parsePedSettings', () => {
  describe('negative cases', () => {
    it('drops a line with no comma', () => {
      expect(parsePedSettings('cesar cesar CIVMALE')).toEqual({});
    });

    it('drops a comma line with fewer than three columns', () => {
      expect(parsePedSettings('280, cesar')).toEqual({});
    });

    it('drops a line whose leading cell is not a numeric id', () => {
      expect(parsePedSettings('cesar, cesar, CIVMALE, gang1')).toEqual({});
    });

    it('drops a prose / unrecognised block', () => {
      expect(parsePedSettings('this is just a note about the ped, nothing structured')).toEqual({});
    });
  });

  describe('positive cases', () => {
    it('classifies a valid peds line', () => {
      expect(parsePedSettings(PEDS_LINE)).toEqual({ pedsLine: PEDS_LINE });
    });

    it('picks the peds line out of a multi-block file, ignoring the rest', () => {
      const text = `# cesar - new gang ped\n\n${PEDS_LINE}\n\nsome unrelated note here`;
      expect(parsePedSettings(text)).toEqual({ pedsLine: PEDS_LINE });
    });
  });
});
