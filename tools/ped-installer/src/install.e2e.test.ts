import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install } from './install';

const PEDS_IDE = join(process.cwd(), 'tests', 'original', 'data', 'peds.ide');
const hasFixtures = existsSync(PEDS_IDE);

const NEW_PED = '299, newped, newtxd, CIVMALE, STAT_STREET_GUY, man, 0, 0, null, 9,9, PED_TYPE_GEN, VOICE_X, VOICE_X';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ped-installer-e2e-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

/** A base game tree: the real stock `peds.ide` + a gta3.img holding a stock ped dff and an unrelated entry. */
function makeGame(): string {
  const gamePath = join(root, 'game');
  mkdirSync(join(gamePath, 'data'), { recursive: true });
  cpSync(PEDS_IDE, join(gamePath, 'data', 'peds.ide'));
  mkdirSync(join(gamePath, 'models'), { recursive: true });
  const img = createImg();
  img.set('bmypol1.dff', Uint8Array.of(9)); // stock model we replace; also the player ped (kept on strip)
  img.set('bmypol1.txd', Uint8Array.of(8)); // the player ped's txd
  img.set('stock.dff', Uint8Array.of(7)); // unrelated entry — survives an un-stripped install, dropped on strip
  writeFileSync(join(gamePath, 'models', 'gta3.img'), img.build());

  return gamePath;
}

/** A ped mod folder under `--in`, with the given asset files and an optional settings file. */
function makePed(name: string, files: Record<string, Uint8Array>, settings?: string): string {
  const mods = join(root, 'in');
  const folder = join(mods, name);
  mkdirSync(folder, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) {
    writeFileSync(join(folder, file), bytes);
  }
  if (settings !== undefined) {
    writeFileSync(join(folder, 'ped.settings.txt'), settings);
  }

  return mods;
}

describe.skipIf(!hasFixtures)('install (end-to-end, real peds.ide fixture)', () => {
  describe('positive cases', () => {
    it('replaces a stock ped model in gta3.img and leaves peds.ide byte-identical (no settings)', () => {
      const game = makeGame();
      const mods = makePed('bmypol1 - HD cop', { 'bmypol1.dff': Uint8Array.of(1), 'bmypol1.txd': Uint8Array.of(2) });
      const out = join(root, 'out');

      install({ gamePath: game, inPath: mods, outPath: out });

      // gta3.img: the new dff replaced the stock one, the txd was added, the unrelated entry survives.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(new Uint8Array(img.get('bmypol1.dff')!)[0]).toBe(1);
      expect(img.has('bmypol1.txd')).toBe(true);
      expect(img.has('stock.dff')).toBe(true);

      // peds.ide untouched — a pure model swap reuses the existing slot.
      expect(readFileSync(join(out, 'data', 'peds.ide'))).toEqual(readFileSync(PEDS_IDE));
    });

    it('adds a brand-new ped: dff/txd into gta3.img + the peds line merged into peds.ide', () => {
      const game = makeGame();
      const mods = makePed(
        'newped - custom',
        { 'newped.dff': Uint8Array.of(1), 'newped.txd': Uint8Array.of(2) },
        NEW_PED,
      );
      const out = join(root, 'out');

      install({ gamePath: game, inPath: mods, outPath: out });

      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('newped.dff')).toBe(true);
      expect(img.has('newped.txd')).toBe(true);

      // peds.ide gained the new ped (and kept the stock ones).
      const defs = parsePedDefs(readFileSync(join(out, 'data', 'peds.ide'), 'utf8'));
      expect(defs.get('newped')).toEqual({ id: 299, model: 'newped', txd: 'newtxd' });
      expect(defs.has('bfori')).toBe(true); // stock entries preserved
    });

    it('replaces an existing peds.ide line in place when a settings line targets that model (no new entry)', () => {
      const game = makeGame();
      // bfori already exists in stock peds.ide (txd BFORI); ship a settings line that changes its txd.
      const updated = '9, bfori, bfori_hd, CIVFEMALE, STAT_COWARD, woman, 0, 0, null, 7,3, PED_TYPE_GEN, V, V';
      const mods = makePed('bfori - HD', { 'bfori.dff': Uint8Array.of(1), 'bfori.txd': Uint8Array.of(2) }, updated);
      const out = join(root, 'out');

      const stockCount = parsePedDefs(readFileSync(PEDS_IDE, 'utf8')).size;
      install({ gamePath: game, inPath: mods, outPath: out });

      const defs = parsePedDefs(readFileSync(join(out, 'data', 'peds.ide'), 'utf8'));
      expect(defs.get('bfori')?.txd).toBe('bfori_hd'); // line replaced in place
      expect(defs.size).toBe(stockCount); // no duplicate / appended entry
    });

    it('--strip reduces gta3.img + peds.ide to only the installed ped and the player ped', () => {
      const game = makeGame();
      const mods = makePed('bfori - HD', { 'bfori.dff': Uint8Array.of(1), 'bfori.txd': Uint8Array.of(2) });
      const out = join(root, 'out');

      // The base game's gta3.img also holds the player ped (bmypol1) and an unrelated entry — both stock.
      install({ gamePath: game, inPath: mods, outPath: out, strip: true });

      // peds.ide: only the installed ped + the player survive.
      const defs = parsePedDefs(readFileSync(join(out, 'data', 'peds.ide'), 'utf8'));
      expect([...defs.keys()].sort()).toEqual(['bfori', 'bmypol1']);

      // gta3.img: only the installed ped's dff/txd + the player's dff/txd remain (stock.dff dropped).
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(
        img
          .names()
          .map((n) => n.toLowerCase())
          .sort(),
      ).toEqual(['bfori.dff', 'bfori.txd', 'bmypol1.dff', 'bmypol1.txd']);
    });
  });
});
