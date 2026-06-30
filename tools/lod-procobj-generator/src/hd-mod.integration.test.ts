import type { TextureSource } from '@opensa/sa-lod/texture-source';

import { writeTxdpHdMod } from '@opensa/map-placement/retxd';
import { encodeLodTxd } from '@opensa/sa-lod/encode-txd';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Integration test for the Modloader **HD mod** emit that `lod-procobj-generator --modloader` uses (its full `run`
 * needs the whole map's collision to scatter procobjs, so the LOD side is covered e2e, not here). Drives the shared
 * `writeTxdpHdMod` with a real fixture DFF (`washer.dff`, textures `junk_tv2`/`junk_washer1`) + a minted parent TXD
 * containing `junk_tv2`, asserting the on-disk `hd/` mod parents the model's stock TXD via `txdp` (no stock IDE).
 */
const WASHER_DFF = 'tests/original/dff/building/washer.dff';
const TXDP_IDE_REL = 'data/maps/lod_procobj_hd.ide';

/** A minimal valid TXD holding one named texture (4×4 RGBA) — the custom parent the stock TXD inherits from. */
function mintTxd(texture: string): Uint8Array {
  const source: TextureSource = {
    get: (name) =>
      name === texture ? { hasAlpha: false, height: 4, rgba: new Uint8Array(4 * 4 * 4), width: 4 } : null,
  };

  return encodeLodTxd([texture], source, 64);
}

describe('writeTxdpHdMod (lod-procobj HD mod)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lod-procobj-hd-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('writes nothing and returns 0 when there is no swap', () => {
      const swapped = writeTxdpHdMod({
        gamePath: dir,
        hdDir: join(dir, 'out', 'hd'),
        idePaths: [],
        inPath: dir,
        swap: new Map(),
        swapModels: [],
        txdpIdeRel: TXDP_IDE_REL,
      });

      expect(swapped).toBe(0);
      expect(existsSync(join(dir, 'out', 'hd'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('emits the swapped DFF + custom parent TXD + a txdp IDE, rewriting no stock IDE', () => {
      const game = join(dir, 'game');
      mkdirSync(join(game, 'data', 'maps'), { recursive: true });
      writeFileSync(join(game, 'data', 'maps', 'stock.ide'), 'objs\n700, mymodel, mystocktxd, 299, 0\nend\n');

      const inDir = join(dir, 'in');
      mkdirSync(inDir, { recursive: true });
      const dff = readFileSync(WASHER_DFF);
      writeFileSync(join(inDir, 'mymodel.dff'), dff);
      writeFileSync(join(inDir, 'custom.txd'), mintTxd('junk_tv2'));

      const out = join(dir, 'out');
      const swapped = writeTxdpHdMod({
        gamePath: game,
        hdDir: join(out, 'hd'),
        idePaths: ['data/maps/stock.ide'],
        inPath: inDir,
        swap: new Map([['mymodel.dff', new Uint8Array(dff)]]),
        swapModels: ['mymodel'],
        txdpIdeRel: TXDP_IDE_REL,
      });

      expect(swapped).toBe(1);
      expect(existsSync(join(out, 'hd', 'gta3img', 'mymodel.dff'))).toBe(true);
      expect(existsSync(join(out, 'hd', 'gta3img', 'custom.txd'))).toBe(true);
      expect(readFileSync(join(out, 'hd', TXDP_IDE_REL), 'utf8')).toBe('txdp\nmystocktxd, custom\nend\n');
      expect(readFileSync(join(out, 'hd', 'loader.txt'), 'utf8')).toBe(`IDE ${TXDP_IDE_REL}\n`);
      // The stock IDE was read for the parent link but never written into the mod.
      expect(existsSync(join(out, 'hd', 'data', 'maps', 'stock.ide'))).toBe(false);
    });
  });
});
