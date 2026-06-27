import { describe, expect, it } from 'vitest';

import { allocateLodIds, buildLodIde, lodAlias, patchGtaDat } from './ide';

describe('allocateLodIds', () => {
  describe('negative cases', () => {
    it('returns an empty map for no models', () => {
      expect(allocateLodIds([], new Set()).size).toBe(0);
    });

    it('throws when the stock id window cannot fit every model (≤ 18630)', () => {
      const used = new Set<number>();
      for (let id = 4000; id <= 18630; id += 1) {
        if (id !== 18630) {
          used.add(id); // leave a single free id, ask for two
        }
      }

      expect(() => allocateLodIds(['a', 'b'], used)).toThrow(/free object ids/);
    });
  });

  describe('positive cases', () => {
    it('assigns the lowest free ids, deduped and sorted', () => {
      // 4000 is taken → the first two free ids are 4001, 4002
      const ids = allocateLodIds(['lodb', 'loda', 'loda'], new Set([4000]));

      expect([...ids]).toEqual([
        ['loda', 4001],
        ['lodb', 4002],
      ]);
    });

    it('fills non-contiguous free ids (a lone gap is usable — ids need not be consecutive)', () => {
      const ids = allocateLodIds(['a', 'b'], new Set([4000, 4001, 4002, 4004]));

      // 4000..4002 taken, 4003 free, 4004 taken, 4005 free → 4003, 4005
      expect([...ids.values()]).toEqual([4003, 4005]);
    });
  });
});

describe('lodAlias', () => {
  describe('negative cases', () => {
    it('aliases a name that would overflow the IMG entry limit to a synthetic id', () => {
      expect(lodAlias('lodgenveg_tallgrass01', 7)).toBe('lodt7');
    });
  });

  describe('positive cases', () => {
    it('keeps a name that fits the entry limit', () => {
      expect(lodAlias('lodash1_hi', 5)).toBe('lodash1_hi');
    });

    it('uses the given prefix for an overflowing name', () => {
      expect(lodAlias('lodgenveg_tallgrass01', 3, 'lpo')).toBe('lpo3');
    });
  });
});

describe('buildLodIde', () => {
  describe('positive cases', () => {
    it('emits an objs section ordered by id, at the given txd + draw distance, with CRLF', () => {
      const text = buildLodIde(
        new Map([
          ['loda', 6526],
          ['lodb', 6527],
        ]),
        'lodtrees',
        1500,
      );

      expect(text).toContain('objs\r\n');
      expect(text).toContain('6526, loda, lodtrees, 1500, 2097284');
      expect(text.indexOf('6526')).toBeLessThan(text.indexOf('6527'));
      expect(text.trimEnd().endsWith('end')).toBe(true);
    });

    it('uses the given txd name and flags override', () => {
      const text = buildLodIde(new Map([['a', 4000]]), 'lod_procobj', 300, 2130048);

      expect(text).toContain('4000, a, lod_procobj, 300, 2130048');
    });
  });
});

describe('patchGtaDat', () => {
  describe('negative cases', () => {
    it('prepends the IDE line when the dat has none', () => {
      const out = patchGtaDat('IMG models\\gta3.img\r\n', 'DATA\\MAPS\\lodtrees.IDE');

      expect(out.split('\r\n')[0]).toBe('IDE DATA\\MAPS\\lodtrees.IDE');
    });
  });

  describe('positive cases', () => {
    it('inserts after the last IDE line, before the IPLs', () => {
      const dat = 'IDE a.ide\r\nIDE b.ide\r\nIPL x.ipl\r\n';
      const out = patchGtaDat(dat, 'DATA\\MAPS\\lodtrees.IDE').split('\r\n');

      expect(out).toEqual(['IDE a.ide', 'IDE b.ide', 'IDE DATA\\MAPS\\lodtrees.IDE', 'IPL x.ipl', '']);
    });
  });
});
