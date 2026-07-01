import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Archive } from './io';

import { resolveLodLinks } from './resolve';

/** A gta3 archive with no binary streams — these tests exercise the text-IPL path only. */
const noStreams = { get: () => null, names: [] } as unknown as Archive;

let dir = '';
afterEach(() => {
  dir = '';
});

/** Write a synthetic game-data dir (one IDE + one text IPL) and resolve it. */
function resolve(ide: string, ipl: string): ReturnType<typeof resolveLodLinks> {
  dir = mkdtempSync(join(tmpdir(), 'salod-resolve-'));
  writeFileSync(join(dir, 'x.ide'), ide);
  writeFileSync(join(dir, 'x.ipl'), ipl);

  return resolveLodLinks(dir, noStreams);
}

const IDE = ['objs', '1, hd_a, txda, 300, 0', '2, lod_a, txdlod, 1500, 0', 'end'].join('\n');

describe('resolveLodLinks', () => {
  describe('negative cases', () => {
    it('skips a link whose HD name is lod-prefixed', () => {
      const ide = ['objs', '1, lodhd, txda, 300, 0', '2, lod_a, txdlod, 1500, 0', 'end'].join('\n');
      const ipl = ['inst', '1, lodhd, 0, 0,0,0, 0,0,0,1, 1', '2, lod_a, 0, 0,0,0, 0,0,0,1, -1', 'end'].join('\n');
      expect(resolve(ide, ipl).links).toHaveLength(0);
    });

    it('excludes a dual-role LOD that is also placed standalone', () => {
      const ipl = [
        'inst',
        '1, hd_a, 0, 0,0,0, 0,0,0,1, 1', // HD → index 1
        '2, lod_a, 0, 0,0,0, 0,0,0,1, -1', // LOD target (index 1)
        '2, lod_a, 0, 9,9,9, 0,0,0,1, -1', // standalone lod_a (index 2 — nothing points here)
        'end',
      ].join('\n');
      const result = resolve(IDE, ipl);
      expect(result.links).toHaveLength(0);
      expect(result.excludedDualRole).toBe(1);
    });

    it('excludes a vegetation LOD (HD in SA_TREE_MODELS)', () => {
      const ide = ['objs', '1, ash1_hi, txda, 300, 0', '2, lod_a, txdlod, 1500, 0', 'end'].join('\n');
      const ipl = ['inst', '1, ash1_hi, 0, 0,0,0, 0,0,0,1, 1', '2, lod_a, 0, 0,0,0, 0,0,0,1, -1', 'end'].join('\n');
      const result = resolve(ide, ipl);
      expect(result.links).toHaveLength(0);
      expect(result.excludedVegetation).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('resolves a text HD→LOD link by index (name-agnostic), carrying ids + txds', () => {
      const ipl = ['inst', '1, hd_a, 0, 0,0,0, 0,0,0,1, 1', '2, lod_a, 0, 0,0,0, 0,0,0,1, -1', 'end'].join('\n');
      const result = resolve(IDE, ipl);
      expect(result.links).toEqual([
        { hdModel: 'hd_a', hdTxd: 'txda', instanceCount: 1, lodId: 2, lodModel: 'lod_a', lodTxd: 'txdlod' },
      ]);
    });

    it('aggregates repeated placements into one link with an instance count', () => {
      const ipl = [
        'inst',
        '1, hd_a, 0, 0,0,0, 0,0,0,1, 1',
        '2, lod_a, 0, 0,0,0, 0,0,0,1, -1',
        '1, hd_a, 0, 5,5,5, 0,0,0,1, 3',
        '2, lod_a, 0, 5,5,5, 0,0,0,1, -1',
        'end',
      ].join('\n');
      const result = resolve(IDE, ipl);
      expect(result.links).toHaveLength(1);
      expect(result.links[0].instanceCount).toBe(2);
    });
  });
});
