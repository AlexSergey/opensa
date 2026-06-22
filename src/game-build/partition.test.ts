import { describe, expect, it } from 'vitest';

import type { ModelRef } from './partition';

import { ideRefs, looseGroup, partitionEntries, placedModels, resolveSource } from './partition';

const ide = new Map<number, ModelRef>([
  [1, { model: 'house', txd: 'htex' }],
  [2, { model: 'shed', txd: 'htex' }], // shares htex with house
  [3, { model: 'tree', txd: 'ttex' }], // dff + txd only in gta_int
  [4, { model: 'ghost', txd: 'gtex' }], // referenced but in neither img
]);

const gta3 = new Set(['house.dff', 'htex.txd', 'la.ipl', 'nodes.dat', 'ped.ifp', 'roads.col', 'shed.dff']);
const gtaInt = new Set(['tree.dff', 'ttex.txd']);

const names = (entries: { name: string }[]): string[] => entries.map((e) => e.name).sort();

describe('resolveSource', () => {
  describe('negative cases', () => {
    it('returns null for a name in neither img', () => {
      expect(resolveSource('ghost.dff', gta3, gtaInt)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('prefers gta3, falls back to gta_int (override)', () => {
      expect(resolveSource('house.dff', gta3, gtaInt)).toBe('gta3');
      expect(resolveSource('tree.dff', gta3, gtaInt)).toBe('gta_int');
    });
  });
});

describe('placedModels', () => {
  describe('positive cases', () => {
    it('collects the unique referenced model + txd base names', () => {
      const refs = placedModels([1, 2, 3, 1, 1], ide); // id 1 thrice → one
      expect(refs.models.sort()).toEqual(['house', 'shed', 'tree']);
      expect(refs.txds.sort()).toEqual(['htex', 'ttex']); // htex shared, deduped
    });

    it('skips ids without an IDE definition', () => {
      expect(placedModels([999], ide)).toEqual({ models: [], txds: [] });
    });
  });
});

describe('partitionEntries', () => {
  const { models, others, textures } = partitionEntries(placedModels([1, 2, 3, 4], ide), gta3, gtaInt);

  describe('negative cases', () => {
    it('drops dff/txd present in neither img', () => {
      expect(names(models)).not.toContain('ghost.dff');
      expect(names(textures)).not.toContain('gtex.txd');
    });

    it('keeps the three buckets disjoint by extension', () => {
      expect(models.every((e) => /\.(?:dff|col)$/.test(e.name))).toBe(true);
      expect(textures.every((e) => e.name.endsWith('.txd'))).toBe(true);
      expect(others.every((e) => /\.(?:ipl|ifp|dat)$/.test(e.name))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('puts placement/anim/data world files (ipl/ifp/dat) in others — no col/dff/txd', () => {
      expect(names(others)).toEqual(['la.ipl', 'nodes.dat', 'ped.ifp']);
    });

    it('puts every referenced dff plus every col in models, resolved across both imgs', () => {
      expect(names(models)).toEqual(['house.dff', 'roads.col', 'shed.dff', 'tree.dff']);
      expect(models.find((e) => e.name === 'tree.dff')?.source).toBe('gta_int'); // override
      expect(models.find((e) => e.name === 'house.dff')?.source).toBe('gta3');
      expect(models.find((e) => e.name === 'roads.col')?.source).toBe('gta3');
    });

    it('puts every referenced txd in textures (deduped), resolved across both imgs', () => {
      expect(names(textures)).toEqual(['htex.txd', 'ttex.txd']);
      expect(textures.find((e) => e.name === 'ttex.txd')?.source).toBe('gta_int');
    });
  });
});

describe('looseGroup', () => {
  describe('positive cases', () => {
    it('routes data-folder files to data regardless of extension', () => {
      expect(looseGroup('data/gta.dat')).toBe('data');
      expect(looseGroup('data/maps/la.ipl')).toBe('data');
    });

    it('routes dff to models, txd to textures, and the rest (ifp/gxt) to others', () => {
      expect(looseGroup('player/tommy.dff')).toBe('models');
      expect(looseGroup('vehicles/admiral.txd')).toBe('textures');
      expect(looseGroup('anim/ped.ifp')).toBe('others');
      expect(looseGroup('text/american.gxt')).toBe('others');
    });
  });
});

describe('ideRefs', () => {
  // objs (5 cols) + a tobj (objs cols + timeOn,timeOff). tobj models must be packed too, or every
  // time-of-day overlay (lit windows / neon) is dropped from the build and vanishes in-game.
  const IDE = [
    'objs',
    '100, house, htex, 299, 0',
    'end',
    'tobj',
    '200, lampwin_nt, lamptex, 299, 0, 20, 6',
    'end',
  ].join('\n');

  describe('positive cases', () => {
    it('includes both objs and tobj models (lowercased) keyed by id', () => {
      const refs = ideRefs(IDE);
      expect(refs.get(100)).toEqual({ model: 'house', txd: 'htex' });
      expect(refs.get(200)).toEqual({ model: 'lampwin_nt', txd: 'lamptex' }); // the tobj model — previously dropped
    });
  });
});
