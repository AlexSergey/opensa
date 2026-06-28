import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mergePedImg } from './img-merge';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ped-img-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A ped folder with the given files, plus a settings file that must be ignored by the IMG merge. */
function pedFolder(files: Record<string, Uint8Array>): string {
  const folder = mkdtempSync(join(dir, 'cesar-'));
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(folder, name), bytes);
  }
  writeFileSync(join(folder, 'cesar.settings.txt'), 'not an asset');

  return folder;
}

describe('mergePedImg', () => {
  describe('negative cases', () => {
    it('returns no names and skips a folder with no dff/txd', () => {
      const folder = mkdtempSync(join(dir, 'empty-'));
      writeFileSync(join(folder, 'readme.txt'), 'x');
      expect(mergePedImg(folder, join(dir, 'gta3.img'))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('writes the dff + txd, ignoring the settings file', () => {
      const folder = pedFolder({ 'cesar.dff': Uint8Array.of(1), 'cesar.txd': Uint8Array.of(2) });
      const imgPath = join(dir, 'gta3.img');

      expect(mergePedImg(folder, imgPath).sort()).toEqual(['cesar.dff', 'cesar.txd']);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(img.has('cesar.dff')).toBe(true);
      expect(img.has('cesar.txd')).toBe(true);
      expect(img.has('cesar.settings.txt')).toBe(false);
    });

    it('replaces an existing entry by name, keeping the others', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('bfori.dff', Uint8Array.of(9)); // stock
      base.set('stock.dff', Uint8Array.of(7));
      writeFileSync(imgPath, base.build());

      mergePedImg(pedFolder({ 'bfori.dff': Uint8Array.of(1) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(new Uint8Array(img.get('bfori.dff')!)[0]).toBe(1); // overridden (VER2 pads the rest of the sector)
      expect(img.has('stock.dff')).toBe(true); // preserved
    });
  });
});
