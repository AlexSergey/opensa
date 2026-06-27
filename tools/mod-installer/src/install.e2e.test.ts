import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install } from './install';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mod-installer-e2e-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function write(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('install (end-to-end)', () => {
  describe('positive cases', () => {
    it('copies the base, overlays mods alphabetically, and merges gta3img into gta3.img', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base game: two data files + a gta3.img with one entry.
      write(join(game, 'data', 'keep.txt'), 'base');
      write(join(game, 'data', 'conf.txt'), 'base');
      const baseImg = createImg();
      baseImg.set('base.dff', Uint8Array.from([1]));
      write(join(game, 'models', 'gta3.img'), baseImg.build());

      // a_mod (applied first): a new file, a conf override, and a gta3img entry.
      write(join(mods, 'a_mod', 'data', 'new.txt'), 'a-new');
      write(join(mods, 'a_mod', 'data', 'conf.txt'), 'a');
      write(join(mods, 'a_mod', 'gta3img', 'x.dff'), Uint8Array.from([2, 2]));

      // b_mod (applied last): another conf override → wins.
      write(join(mods, 'b_mod', 'data', 'conf.txt'), 'b');

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(readFileSync(join(out, 'data', 'keep.txt'), 'utf8')).toBe('base'); // untouched base file
      expect(readFileSync(join(out, 'data', 'new.txt'), 'utf8')).toBe('a-new'); // added by a_mod
      expect(readFileSync(join(out, 'data', 'conf.txt'), 'utf8')).toBe('b'); // b_mod applied after a_mod → wins
      expect(existsSync(join(out, 'gta3img'))).toBe(false); // gta3img is merged, never copied as a folder

      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('base.dff')).toBe(true); // base archive entry preserved
      expect(img.has('x.dff')).toBe(true); // merged from a_mod/gta3img
    });
  });
});
