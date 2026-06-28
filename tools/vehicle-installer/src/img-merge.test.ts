import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mergeVehicleImg } from './img-merge';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vehicle-img-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A vehicle folder with the given files, plus a settings file that must be ignored by the IMG merge. */
function vehicleFolder(files: Record<string, Uint8Array>): string {
  const folder = mkdtempSync(join(dir, 'alpha-'));
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(folder, name), bytes);
  }
  writeFileSync(join(folder, 'alpha.settings.txt'), 'not an asset');

  return folder;
}

describe('mergeVehicleImg', () => {
  describe('negative cases', () => {
    it('returns no names and skips a folder with no dff/txd', () => {
      const folder = mkdtempSync(join(dir, 'empty-'));
      writeFileSync(join(folder, 'readme.txt'), 'x');
      expect(mergeVehicleImg(folder, join(dir, 'gta3.img'))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('writes the dff + every txd (incl. extra numbered ones), ignoring the settings file', () => {
      const folder = vehicleFolder({
        'alpha1.txd': Uint8Array.of(3),
        'alpha2.txd': Uint8Array.of(4),
        'alpha.dff': Uint8Array.of(1),
        'alpha.txd': Uint8Array.of(2),
      });
      const imgPath = join(dir, 'gta3.img');

      expect(mergeVehicleImg(folder, imgPath).sort()).toEqual(['alpha.dff', 'alpha.txd', 'alpha1.txd', 'alpha2.txd']);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(img.has('alpha.dff')).toBe(true);
      expect(img.has('alpha.txd')).toBe(true);
      expect(img.has('alpha1.txd')).toBe(true);
      expect(img.has('alpha2.txd')).toBe(true);
      expect(img.has('alpha.settings.txt')).toBe(false);
    });

    it('replaces an existing entry by name, keeping the others', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('alpha.dff', Uint8Array.of(9)); // stock
      base.set('stock.dff', Uint8Array.of(7));
      writeFileSync(imgPath, base.build());

      mergeVehicleImg(vehicleFolder({ 'alpha.dff': Uint8Array.of(1) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(new Uint8Array(img.get('alpha.dff')!)[0]).toBe(1); // overridden (VER2 pads the rest of the sector)
      expect(img.has('stock.dff')).toBe(true); // preserved
    });
  });
});
