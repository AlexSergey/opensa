import { describe, expect, it } from 'vitest';

import { collectImgEntries } from './build';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('collectImgEntries', () => {
  describe('negative cases', () => {
    it('emits only the shared lod_procobj.txd/col when there are no LODs or swaps', () => {
      const entries = collectImgEntries([], bytes(1), bytes(2), new Map(), new Map());

      expect([...entries.keys()].sort()).toEqual(['lod_procobj.col', 'lod_procobj.txd']);
      expect(entries.get('lod_procobj.txd')).toEqual(bytes(1));
      expect(entries.get('lod_procobj.col')).toEqual(bytes(2));
    });
  });

  describe('positive cases', () => {
    it('keys each LOD by `<alias>.dff` and includes the swapped HD DFFs + custom TXDs', () => {
      const lods = [
        { alias: 'lpo0', dff: bytes(10) },
        { alias: 'lodcedar1_po', dff: bytes(11) },
      ];
      const swap = new Map([['cedar1_po.dff', bytes(20)]]);
      const retxdTxds = new Map([['vegetation.txd', bytes(30)]]);

      const entries = collectImgEntries(lods, bytes(1), bytes(2), swap, retxdTxds);

      expect([...entries.keys()].sort()).toEqual([
        'cedar1_po.dff',
        'lod_procobj.col',
        'lod_procobj.txd',
        'lodcedar1_po.dff',
        'lpo0.dff',
        'vegetation.txd',
      ]);
      expect(entries.get('lpo0.dff')).toEqual(bytes(10));
      expect(entries.get('lodcedar1_po.dff')).toEqual(bytes(11));
      expect(entries.get('cedar1_po.dff')).toEqual(bytes(20));
      expect(entries.get('vegetation.txd')).toEqual(bytes(30));
    });
  });
});
