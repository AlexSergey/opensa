import { describe, expect, it } from 'vitest';

import { allocateImpostorIds, buildLodTreesIde, impostorAlias, patchGtaDat } from './ide';

describe('allocateImpostorIds', () => {
  describe('negative cases', () => {
    it('returns an empty map for no models', () => {
      expect(allocateImpostorIds([], new Set()).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('assigns ids from the lowest free gap, deduped and sorted', () => {
      // 4000 is taken → the first run of two free ids starts at 4001
      const ids = allocateImpostorIds(['lodb', 'loda', 'loda'], new Set([4000]));

      expect([...ids]).toEqual([
        ['loda', 4001],
        ['lodb', 4002],
      ]);
    });

    it('skips an occupied run to find a gap that fits', () => {
      const ids = allocateImpostorIds(['a', 'b'], new Set([4000, 4001, 4002, 4004]));

      // 4000..4002 taken, 4003 alone is too small, 4004 taken → fits at 4005..4006
      expect([...ids.values()]).toEqual([4005, 4006]);
    });
  });
});

describe('impostorAlias', () => {
  describe('negative cases', () => {
    it('aliases a name that would overflow the IMG entry limit to a synthetic id', () => {
      expect(impostorAlias('lodgenveg_tallgrass01', 7)).toBe('lodt7');
    });
  });

  describe('positive cases', () => {
    it('keeps a name that fits the entry limit', () => {
      expect(impostorAlias('lodash1_hi', 5)).toBe('lodash1_hi');
    });
  });
});

describe('buildLodTreesIde', () => {
  describe('positive cases', () => {
    it('emits an objs section ordered by id, at the given draw distance, with CRLF', () => {
      const text = buildLodTreesIde(
        new Map([
          ['loda', 6526],
          ['lodb', 6527],
        ]),
        1500,
      );

      expect(text).toContain('objs\r\n');
      expect(text).toContain('6526, loda, lodtrees, 1500, 2097284');
      expect(text.indexOf('6526')).toBeLessThan(text.indexOf('6527'));
      expect(text.trimEnd().endsWith('end')).toBe(true);
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
