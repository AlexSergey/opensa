import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mergeGta3Img } from './img-merge';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mod-installer-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a `gta3img/` folder with the given `name → bytes` entries; returns its path. */
function gta3imgDir(entries: Record<string, Uint8Array>): string {
  const path = join(dir, 'gta3img');
  mkdirSync(path, { recursive: true });
  for (const [name, bytes] of Object.entries(entries)) {
    writeFileSync(join(path, name), bytes);
  }

  return path;
}

describe('mergeGta3Img', () => {
  describe('negative cases', () => {
    it('does nothing for an empty gta3img folder', () => {
      const path = join(dir, 'gta3img');
      mkdirSync(path, { recursive: true });

      expect(mergeGta3Img(path, join(dir, 'models', 'gta3.img'))).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('seeds a fresh archive when the target img does not exist', () => {
      const imgPath = join(dir, 'models', 'gta3.img');
      const merged = mergeGta3Img(gta3imgDir({ 'a.dff': Uint8Array.from([1, 2, 3, 4]) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(merged).toBe(1);
      expect(img.has('a.dff')).toBe(true);
      // IMG VER2 pads entries to 2048-byte sectors, so compare the leading bytes.
      expect([...img.get('a.dff')!.slice(0, 4)]).toEqual([1, 2, 3, 4]);
    });

    it('replaces an existing entry by name and keeps the others', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('a.dff', Uint8Array.from([9, 9]));
      base.set('keep.dff', Uint8Array.from([7]));
      writeFileSync(imgPath, base.build());

      mergeGta3Img(gta3imgDir({ 'a.dff': Uint8Array.from([1, 1, 1, 1]) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect([...img.get('a.dff')!.slice(0, 4)]).toEqual([1, 1, 1, 1]); // replaced
      expect(img.has('keep.dff')).toBe(true); // untouched
    });
  });
});
