import { describe, expect, it } from 'vitest';

import { mergeCarcols, mergeGtaDat, mergeHandling, mergeIde } from './merge';

describe('mergeGtaDat', () => {
  describe('negative cases', () => {
    it('returns the base unchanged with no refs', () => {
      const base = 'IDE data/maps/stock.ide\nIPL data/maps/stock.ipl\n';

      expect(mergeGtaDat(base, { ide: [], ipl: [] })).toBe(base);
    });

    it('skips a ref already listed (case/slash-insensitive) so it never double-places', () => {
      const base = 'IPL data/maps/stock.ipl\n';

      expect(mergeGtaDat(base, { ide: [], ipl: ['DATA\\MAPS\\stock.ipl'] })).toBe(base);
    });
  });

  describe('positive cases', () => {
    it('appends the new IDE/IPL lines (verbatim) after the stock ones', () => {
      const out = mergeGtaDat('IDE data/maps/stock.ide\n', {
        ide: ['data/maps/lodtrees.ide', 'data/maps/lodtrees_hd.ide'],
        ipl: ['data/maps/lod_procobj.ipl'],
      });

      expect(out).toBe(
        'IDE data/maps/stock.ide\nIDE data/maps/lodtrees.ide\nIDE data/maps/lodtrees_hd.ide\nIPL data/maps/lod_procobj.ipl\n',
      );
    });

    it('dedups a ref repeated across loader files', () => {
      const out = mergeGtaDat('', { ide: ['x.ide', 'X.IDE'], ipl: [] });

      expect(out).toBe('IDE x.ide\n');
    });
  });
});

describe('mergeIde', () => {
  describe('negative cases', () => {
    it('returns the base unchanged with no lines', () => {
      const base = 'cars\n400, landstal, landstal, car\nend\n';

      expect(mergeIde(base, [])).toBe(base);
    });
  });

  describe('positive cases', () => {
    it('replaces the cars line for the model and leaves the others', () => {
      const base = 'cars\n400, landstal, landstal, car, LANDSTAL\n416, ambulan, old, car, OLD\nend\n';
      const out = mergeIde(base, ['416, ambulan, ambulan, car, AMBULAN, AMBULAN, van']);
      const lines = out.split('\n');

      expect(lines).toContain('416, ambulan, ambulan, car, AMBULAN, AMBULAN, van');
      expect(lines).toContain('400, landstal, landstal, car, LANDSTAL'); // untouched
      expect(out).not.toContain('416, ambulan, old');
    });

    it('appends a new model before end', () => {
      const out = mergeIde('cars\n400, landstal, landstal, car\nend\n', ['500, newcar, newcar, car, NEW, NEW, x']);
      const lines = out.split('\n');

      expect(lines.indexOf('500, newcar, newcar, car, NEW, NEW, x')).toBeLessThan(lines.indexOf('end'));
    });
  });
});

describe('mergeHandling', () => {
  describe('positive cases', () => {
    it('replaces the car-table line by id, leaving comments and sub-tables alone', () => {
      const base = '; comment\nLANDSTAL 1700 5000\nAMBULAN 3000 9000\n!BOAT 1000 2000\n';
      const out = mergeHandling(base, ['AMBULAN 3500 14000 extra']);
      const lines = out.split('\n');

      expect(lines).toContain('AMBULAN 3500 14000 extra');
      expect(lines).toContain('LANDSTAL 1700 5000'); // untouched
      expect(lines).toContain('!BOAT 1000 2000'); // sub-table untouched
      expect(lines).toContain('; comment'); // comment untouched
      expect(out).not.toContain('AMBULAN 3000 9000');
    });
  });
});

describe('mergeCarcols', () => {
  describe('positive cases', () => {
    it('replaces a car-section line by model, leaving the palette and other cars', () => {
      const base = 'col\n0,0,0\n255,255,255\nend\ncar\nlandstal, 1,1\nambulan, 9,9\nend\n';
      const out = mergeCarcols(base, ['ambulan, 1,3']);
      const lines = out.split('\n');

      expect(lines).toContain('ambulan, 1,3');
      expect(lines).toContain('landstal, 1,1'); // other car untouched
      expect(lines).toContain('255,255,255'); // palette untouched
      expect(out).not.toContain('ambulan, 9,9');
    });
  });
});
