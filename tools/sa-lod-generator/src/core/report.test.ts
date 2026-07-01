import { describe, expect, it } from 'vitest';

import type { LodLink } from './types';

import { perObjectLinks, summarize } from './report';

const TRIS: Record<string, number> = { hda: 10, hdb: 20, hdc: 50, lodx: 3, lodz: 5 };
const tris = (model: string): number => TRIS[model] ?? 0;

function link(hdModel: string, lodModel: string, instanceCount: number): LodLink {
  return { hdModel, hdTxd: `${hdModel}txd`, instanceCount, lodId: 1, lodModel, lodTxd: 'txd' };
}

describe('summarize', () => {
  describe('negative cases', () => {
    it('is all-zero with no links', () => {
      const r = summarize({ excludedDualRole: 0, excludedVegetation: 0, links: [], unresolved: 0 }, tris);
      expect(r).toMatchObject({
        farViewCloneTris: 0,
        hdModels: 0,
        links: 0,
        lodModels: 0,
        perObjectLods: 0,
        sharedLods: 0,
      });
    });
  });

  describe('positive cases', () => {
    it('splits per-object vs shared and sums far-view per instance, layer per unique model', () => {
      // lodx is shared (hda + hdb link to it); lodz is per-object (only hdc).
      const r = summarize(
        {
          excludedDualRole: 0,
          excludedVegetation: 0,
          links: [link('hda', 'lodx', 2), link('hdb', 'lodx', 1), link('hdc', 'lodz', 3)],
          unresolved: 4,
        },
        tris,
      );

      expect(r.links).toBe(6); // 2 + 1 + 3 instances
      expect(r.lodModels).toBe(2);
      expect(r.hdModels).toBe(3);
      expect(r.perObjectLods).toBe(1); // lodz
      expect(r.sharedLods).toBe(1); // lodx (two HD models)
      // far-view = Σ instanceCount × tris: stock 2·3 + 1·3 + 3·5 = 24; clone 2·10 + 1·20 + 3·50 = 190.
      expect(r.farViewStockTris).toBe(24);
      expect(r.farViewCloneTris).toBe(190);
      // layer = each distinct model once: stock lodx+lodz = 8; clone hda+hdb+hdc = 80.
      expect(r.layerStockTris).toBe(8);
      expect(r.layerCloneTris).toBe(80);
      expect(r.unresolved).toBe(4);
    });
  });
});

describe('perObjectLinks', () => {
  describe('negative cases', () => {
    it('drops LODs shared by more than one HD model', () => {
      const shared = [link('hda', 'lodx', 1), link('hdb', 'lodx', 1)];
      expect(perObjectLinks(shared)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('keeps only the 1:1 links', () => {
      const links = [link('hda', 'lodx', 2), link('hdb', 'lodx', 1), link('hdc', 'lodz', 3)];
      expect(perObjectLinks(links).map((l) => l.lodModel)).toEqual(['lodz']);
    });
  });
});
