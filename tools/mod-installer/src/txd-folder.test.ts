import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pngToTextureNative } from './png-texture';
import { buildTxd, encodePng, solidRgba } from './test-utils';
import { mergeTxdFolder } from './txd-folder';

const VERSION = 0x1803ffff;
const png = (size: number, color: [number, number, number, number]): Uint8Array =>
  encodePng(solidRgba(size, size, color), size, size);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'txd-folder-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('mergeTxdFolder', () => {
  describe('negative cases', () => {
    it('does nothing (0) for a folder with no PNGs', () => {
      const txdPath = join(dir, 'base.txd');
      writeFileSync(txdPath, buildTxd([pngToTextureNative('texa', png(8, [1, 2, 3, 255]), VERSION)], VERSION));
      const empty = mkdtempSync(join(dir, 'empty-'));
      expect(mergeTxdFolder(empty, txdPath)).toBe(0);
    });

    it('throws when the target file is not a TXD', () => {
      const txdPath = join(dir, 'bogus.txd');
      writeFileSync(txdPath, new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4])); // no texture-dictionary chunk
      const folder = mkdtempSync(join(dir, 'merge-'));
      writeFileSync(join(folder, 'tex.png'), png(8, [1, 2, 3, 255]));
      expect(() => mergeTxdFolder(folder, txdPath)).toThrow(/not a TXD/);
    });
  });

  describe('positive cases', () => {
    it('replaces a same-named texture and adds a new one, leaving the rest untouched', () => {
      const txdPath = join(dir, 'base.txd');
      writeFileSync(
        txdPath,
        buildTxd(
          [
            pngToTextureNative('texa', png(8, [10, 20, 30, 255]), VERSION),
            pngToTextureNative('texb', png(8, [40, 50, 60, 255]), VERSION),
          ],
          VERSION,
        ),
      );
      const folder = mkdtempSync(join(dir, 'merge-'));
      writeFileSync(join(folder, 'texb.png'), png(16, [70, 80, 90, 255])); // replace texb (bigger)
      writeFileSync(join(folder, 'texc.png'), png(4, [11, 22, 33, 128])); // add texc (alpha → dxt5)

      const merged = mergeTxdFolder(folder, txdPath);
      expect(merged).toBe(2);

      const textures = parseTxd(Uint8Array.from(readFileSync(txdPath)).buffer).textures;
      const byName = new Map(textures.map((t) => [t.name, t]));
      expect([...byName.keys()].sort()).toEqual(['texa', 'texb', 'texc']);
      expect(byName.get('texa')?.width).toBe(8); // untouched
      expect(byName.get('texb')?.width).toBe(16); // replaced (was 8)
      expect(byName.get('texc')?.format).toBe('dxt5'); // added, alpha
    });
  });
});
