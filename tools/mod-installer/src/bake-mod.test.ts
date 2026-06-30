import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bakeMod, scanModloaderMod } from './bake-mod';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bake-mod-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a file (and its parents) under `dir`, returning its absolute path. */
function write(rel: string, content: string | Uint8Array): string {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);

  return path;
}

/** A full 14-column procobj.dat data row (`surface model spacing …`). */
const proc = (surface: string, model: string, spacing: string): string =>
  [surface, model, spacing, '60', '0', '360', '1', '1', '1', '1', '0', '0', '0', '0'].join('\t');

describe('scanModloaderMod', () => {
  describe('negative cases', () => {
    it('reports loaderFound=false for a plain mod (a dff + a prose readme, no loader directives)', () => {
      write('mod/models/x.dff', Uint8Array.of(1));
      write('mod/readme.txt', 'Thanks for downloading! KEEP THIS FILE INSIDE MODLOADER');
      const scan = scanModloaderMod(join(dir, 'mod'));

      expect(scan.loaderFound).toBe(false);
      expect([...scan.assets.keys()]).toEqual(['x.dff']);
      expect(scan.refs).toEqual({ col: [], ide: [], ipl: [] });
    });
  });

  describe('positive cases', () => {
    it('buckets assets / texts / dataMerges by bare name and collects loader IDE/IPL/COLFILE refs', () => {
      write('mod/sub/Loader.txt', 'IDE data/maps/a.ide\nIPL data/maps/b.ipl\nCOLFILE 0 data/maps/c.col');
      write('mod/files/hero.dff', Uint8Array.of(1));
      write('mod/files/hero.txd', Uint8Array.of(2));
      write('mod/col/c.col', Uint8Array.of(3));
      write('mod/data/maps/a.ide', 'objs\nend');
      write('mod/data/procobj.dat', proc('p_sand', 'cactus', '16'));
      write('mod/notes.txt', 'just prose, no directives here');
      const scan = scanModloaderMod(join(dir, 'mod'));

      expect(scan.loaderFound).toBe(true);
      expect([...scan.assets.keys()].sort()).toEqual(['c.col', 'hero.dff', 'hero.txd']);
      expect([...scan.texts.keys()]).toEqual(['a.ide']);
      expect([...scan.dataMerges.keys()]).toEqual(['procobj.dat']);
      expect(scan.refs.ide).toEqual(['data/maps/a.ide']);
      expect(scan.refs.ipl).toEqual(['data/maps/b.ipl']);
      expect(scan.refs.col).toEqual(['data/maps/c.col']);
    });

    it('detects a UTF-16 loader file (BOM-aware read) — the real SA Brightened Project fixture', () => {
      cpSync('tests/custom/modloader/utf16-loader.txt', join(dir, 'mod', 'Loader.txt'));
      const scan = scanModloaderMod(join(dir, 'mod'));

      expect(scan.loaderFound).toBe(true);
      expect(scan.refs.ipl).toContain('data\\maps\\vinelumination.ipl');
    });
  });
});

describe('bakeMod', () => {
  /** Lay down a minimal stock `--out` tree: gta.dat + a stock IDE + stock procobj.dat + a seeded gta3.img. */
  function stockOut(): string {
    const out = join(dir, 'out');
    write('out/data/gta.dat', 'IDE DATA\\MAPS\\stock.ide\n'); // stock gta.dat uses backslashes
    write('out/data/maps/stock.ide', 'objs\n700, stocktree, stocktxd, 299, 0\nend\n');
    write('out/data/procobj.dat', `# stock\n${proc('p_sand', 'cactus', '16')}\n`);
    const img = createImg();
    img.set('existing.dff', Uint8Array.of(9));
    write('out/models/gta3.img', img.build());

    return out;
  }

  describe('negative cases', () => {
    it('returns baked=false for a mod with no loader (caller should overlay instead)', () => {
      write('mod/models/x.dff', Uint8Array.of(1));

      expect(bakeMod(join(dir, 'mod'), stockOut())).toEqual({ assets: 0, baked: false, texts: 0 });
    });
  });

  describe('positive cases', () => {
    it('patches gta.dat, places new + overwrites stock, merges procobj additively, injects gta3.img', () => {
      const out = stockOut();
      write('mod/loader.txt', 'IDE data/maps/newdefs.ide\nIPL data/maps/newplace.ipl\nCOLFILE 0 data/maps/new.col');
      write('mod/files/newdefs.ide', 'objs\n5000, newobj, newtxd, 1500, 0\nend\n'); // new → declared path
      write('mod/deep/newplace.ipl', 'inst\n5000, newobj, 0, 1, 2, 3, 0, 0, 0, 1, -1\nend\n'); // new → declared
      write('mod/x/stock.ide', 'objs\n700, stocktree, MODTXD, 299, 0\nend\n'); // modified stock → overwrite in place
      write('mod/y/custom.dff', Uint8Array.of(1, 2, 3)); // scattered → gta3.img
      write('mod/z/new.col', Uint8Array.of(4, 5)); // COLFILE col → gta3.img (auto-discovered, no COLFILE line)
      write('mod/data/procobj.dat', `${proc('p_sand', 'cactus', '99')}\n${proc('p_dirt', 'weed', '12')}`);
      write('mod/readme.txt', 'thanks — KEEP THIS INSIDE MODLOADER'); // prose → ignored

      const result = bakeMod(join(dir, 'mod'), out);

      expect(result.baked).toBe(true);
      // 1. gta.dat: the loader's new IDE/IPL registered, canonicalised to `DATA\MAPS\…` (filename as-is); COLFILE
      //    dropped (col → img).
      const gtaDat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(gtaDat).toContain('IDE DATA\\MAPS\\newdefs.ide');
      expect(gtaDat).toContain('IPL DATA\\MAPS\\newplace.ipl');
      expect(gtaDat).not.toContain('COLFILE');
      expect(gtaDat).not.toMatch(/^(IDE|IPL) .*\//m); // no forward slashes in any directive line
      expect(gtaDat).not.toMatch(/^(IDE|IPL) [^\\]*data\\/m); // no lowercase `data\` directory
      // 2. new files written at the loader-declared paths; stock IDE overwritten in place.
      expect(readFileSync(join(out, 'data', 'maps', 'newdefs.ide'), 'utf8')).toContain('5000, newobj');
      expect(readFileSync(join(out, 'data', 'maps', 'newplace.ipl'), 'utf8')).toContain('5000, newobj');
      expect(readFileSync(join(out, 'data', 'maps', 'stock.ide'), 'utf8')).toContain('MODTXD');
      // 3. procobj.dat merged additively (cactus replaced, weed added, comment + the rest kept).
      const procobj = readFileSync(join(out, 'data', 'procobj.dat'), 'utf8');
      expect(procobj).toContain('# stock');
      expect(procobj).toContain('p_sand\tcactus\t99');
      expect(procobj).toContain('p_dirt\tweed');
      // 4. scattered dff + col injected into gta3.img by name; the existing entry kept.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('custom.dff')).toBe(true);
      expect(img.has('new.col')).toBe(true);
      expect(img.has('existing.dff')).toBe(true);
      // prose readme never reached the tree.
      expect(existsSync(join(out, 'readme.txt'))).toBe(false);
    });
  });
});
