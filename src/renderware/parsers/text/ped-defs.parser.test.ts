import { describe, expect, it } from 'vitest';

import { parsePedDefs } from './ped-defs.parser';

const IDE = [
  'peds',
  '# a comment',
  '66, BMYPOL1, BMYpol1, CIVMALE, STAT_TOUGH_GUY, man, 110F,1, man,0,0,PED_TYPE_GEN',
  '9, CESAR, CESAR, CIVMALE, STAT_GANG1, peds, 5300, ped',
  'end',
  'objs',
  '700, tree, treetxd, 200, 0',
  'end',
].join('\n');

describe('parsePedDefs', () => {
  describe('negative cases', () => {
    it('returns an empty map when there is no peds section', () => {
      expect(parsePedDefs('objs\n700, tree, treetxd, 200, 0\nend').size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('maps lowercased model name → {id, model, txd} from the peds section only', () => {
      const defs = parsePedDefs(IDE);

      expect(defs.size).toBe(2);
      expect(defs.get('bmypol1')).toEqual({ id: 66, model: 'BMYPOL1', txd: 'BMYpol1' });
      expect(defs.get('cesar')).toEqual({ id: 9, model: 'CESAR', txd: 'CESAR' });
      expect(defs.has('tree')).toBe(false); // objs rows are ignored
    });
  });
});
