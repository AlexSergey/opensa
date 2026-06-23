import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GameAdapter } from './adapter';
import type { Asset, AssetRef, MapPlugin, WriteResult } from './asset';

import { runPipeline } from './pipeline';

/** An in-memory adapter (no game, no `../src`): accumulates on write, emits the files on finalize. */
function fakeAdapter(names: string[]): GameAdapter {
  const assets = new Map(names.map((name) => [name, makeAsset(name)]));
  const written: WriteResult[] = [];

  return {
    finalize: (dir: string): void => {
      for (const result of written) {
        writeFileSync(join(dir, result.fileName), result.bytes);
      }
    },
    game: 'fake',
    read: (ref: AssetRef): Asset => assets.get(ref.name)!,
    resolve: (): AssetRef[] => names.map((name) => ({ name })),
    write: (asset: Asset): WriteResult => {
      const result = { bytes: asset.source, fileName: `${asset.name}.bin` };
      written.push(result);

      return result;
    },
  };
}

function makeAsset(name: string): Asset {
  return { dirty: false, ir: { meshes: [] }, log: [], meta: {}, name, source: new Uint8Array([1, 2, 3]) };
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'mapopt-'));
});

afterEach(() => {
  rmSync(outDir, { force: true, recursive: true });
});

describe('runPipeline', () => {
  describe('negative cases', () => {
    it('isolates a failing asset and still writes the rest', async () => {
      const boom: MapPlugin = {
        name: 'boom',
        transform: (asset): void => {
          if (asset.name === 'bad') {
            throw new Error('kaboom');
          }
        },
      };
      const report = await runPipeline(fakeAdapter(['ok1', 'bad', 'ok2']), { plugins: [boom] }, outDir);

      expect(report.failures).toEqual([{ error: 'kaboom', name: 'bad' }]);
      expect(report.assets.map((asset) => asset.name).sort()).toEqual(['ok1', 'ok2']);
      expect(readdirSync(outDir).sort()).toEqual(['ok1.bin', 'ok2.bin']);
      expect(existsSync(join(outDir, 'bad.bin'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('runs plugins in order and writes one file per resolved model', async () => {
      const order: string[] = [];
      const stage = (name: string): MapPlugin => ({
        name,
        transform: (): void => {
          order.push(name);
        },
      });
      const report = await runPipeline(fakeAdapter(['m1']), { plugins: [stage('a'), stage('b')] }, outDir);

      expect(order).toEqual(['a', 'b']);
      expect(report.assets).toHaveLength(1);
      expect(readdirSync(outDir)).toEqual(['m1.bin']);
    });

    it('reports an asset as dirty once a plugin mutates it', async () => {
      const mutate: MapPlugin = {
        name: 'mutate',
        transform: (asset, context): void => {
          asset.dirty = true;
          context.log(asset, 'mutate', 'changed');
        },
      };
      const report = await runPipeline(fakeAdapter(['m1']), { plugins: [mutate] }, outDir);

      expect(report.assets[0].dirty).toBe(true);
      expect(report.assets[0].applied).toEqual(['mutate']);
    });

    it('skips a plugin whose accepts() returns false', async () => {
      const seen: string[] = [];
      const picky: MapPlugin = {
        accepts: (asset): boolean => asset.name === 'keep',
        name: 'picky',
        transform: (asset): void => {
          seen.push(asset.name);
        },
      };
      await runPipeline(fakeAdapter(['keep', 'skip']), { plugins: [picky] }, outDir);

      expect(seen).toEqual(['keep']);
    });
  });
});
