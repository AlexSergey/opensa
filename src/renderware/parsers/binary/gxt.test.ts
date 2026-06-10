import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseZones } from '../text/zon.parser';
import { gxtKeyHash, parseGxt } from './gxt';

const GXT_PATH = join(process.cwd(), 'tests', 'text', 'american.gxt');
const ZON_PATH = join(process.cwd(), 'tests', 'data', 'info.zon');
const haveFixtures = existsSync(GXT_PATH) && existsSync(ZON_PATH);

function readGxt(): Map<number, string> {
  const file = readFileSync(GXT_PATH);

  return parseGxt(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
}

describe('gxtKeyHash', () => {
  describe('negative cases', () => {
    it('distinct keys hash differently', () => {
      expect(gxtKeyHash('LINDEN')).not.toBe(gxtKeyHash('LMEX'));
    });
  });

  describe('positive cases', () => {
    it('is deterministic and uppercases the key', () => {
      expect(gxtKeyHash('linden')).toBe(gxtKeyHash('LINDEN'));
    });
  });
});

describe('parseGxt', () => {
  describe('negative cases', () => {
    it('throws on a non-GXT buffer', () => {
      expect(() => parseGxt(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow(/GXT/);
    });
  });

  describe.skipIf(!haveFixtures)('positive cases (real american.gxt)', () => {
    it('parses the file into many hashed entries', () => {
      expect(readGxt().size).toBeGreaterThan(1000);
    });

    it('resolves known district keys to their display text', () => {
      const gxt = readGxt();
      expect(gxt.get(gxtKeyHash('GAN'))).toBe('Ganton'); // the player-spawn district
      expect(gxt.get(gxtKeyHash('LINDEN'))).toBe('Linden Station');
      expect(gxt.get(gxtKeyHash('LMEX'))).toBe('Little Mexico');
      expect(gxt.get(gxtKeyHash('REST'))).toBe('Restricted Area');
    });

    it('resolves every real info.zon zone label (col 10, the GXT key) to non-empty text', () => {
      const gxt = readGxt();
      const labels = [...new Set(parseZones(readFileSync(ZON_PATH, 'latin1')).map((zone) => zone.label))];
      const named = labels.filter((label) => (gxt.get(gxtKeyHash(label)) ?? '').trim() !== '').length;
      expect(named).toBe(labels.length);
    });
  });
});
