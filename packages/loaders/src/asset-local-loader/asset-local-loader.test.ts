import { describe, expect, it, vi } from 'vitest';

import type { ProgressSnapshot } from '../types';
import type { AssetLocalLoaderConfig, AssetLocalLoaderDeps } from './asset-local-loader';
import type { InstallSource } from './build-vfs';
import type { LazyImgArchive } from './img-reader';

import { AssetLocalLoader } from './asset-local-loader';

type AddFiles = (chunkId: string, entries: Iterable<readonly [string, Uint8Array]>) => void;

const IDE = ['objs', '100, cj, cjtxd, 100, 0', 'end'].join('\n');
const IPL = ['inst', '100, cj, 0, 0, 0, 0, 0, 0, 0, 1, 0', 'end'].join('\n');
const DIR = { name: 'gta-sa' } as unknown as FileSystemDirectoryHandle;

/** Deps wired to fakes (prompt → DIR, nothing remembered); override per test. */
function deps(overrides: Partial<AssetLocalLoaderDeps> = {}): AssetLocalLoaderDeps {
  return {
    acquireDir: () => Promise.resolve(DIR),
    openSource: () => Promise.resolve(fakeSource()),
    restoreDir: () => Promise.resolve({ handle: null, ready: false }),
    ...overrides,
  };
}

function fakeArchive(files: Record<string, Uint8Array>): LazyImgArchive {
  return {
    has: (name) => name.toLowerCase() in files,
    names: Object.keys(files),
    read: (name) => Promise.resolve(files[name.toLowerCase()] ?? null),
  };
}

/** A fake install: one placed model (cj) + a world file (la.col) + loose IDE/IPL. */
function fakeSource(): InstallSource {
  const loose: Record<string, string> = { 'data/gta.dat': 'x', 'data/maps/test.ide': IDE, 'data/maps/test.ipl': IPL };
  const gta3 = fakeArchive({
    'cj.dff': new Uint8Array([1]),
    'cjtxd.txd': new Uint8Array([2]),
    'la.col': new Uint8Array([3]),
  });

  return {
    gta3,
    gtaInt: null,
    looseFiles: () => Promise.resolve(Object.keys(loose)),
    readLoose: (path) => Promise.resolve(new TextEncoder().encode(loose[path])),
    readLooseText: (path) => Promise.resolve(loose[path] ?? ''),
  };
}

function make(
  config: Partial<AssetLocalLoaderConfig>,
  overrides: Partial<AssetLocalLoaderDeps> = {},
): AssetLocalLoader {
  return new AssetLocalLoader({ game: 'gta-sa', version: '1.0.0', ...config }, deps(overrides));
}

describe('AssetLocalLoader', () => {
  describe('negative cases', () => {
    it('init throws when no folder was prepared/restored', async () => {
      await expect(make({}).init()).rejects.toThrow(/folder not selected/i);
    });

    it('prepare forgets the stored handle when the prompt is rejected', async () => {
      const local = make({}, { acquireDir: () => Promise.reject(new Error('AbortError')) });

      await expect(local.prepare()).rejects.toThrow(/AbortError/);
    });
  });

  describe('positive cases', () => {
    it('init synthesises a manifest whose entry counts match the selection', async () => {
      const local = make({});
      await local.prepare();
      const manifest = await local.init();

      // data = 3 loose (all under data/); models = cj.dff + la.col; textures = cjtxd.txd; others = none.
      expect(manifest.chunks.data[0].entries).toBe(3);
      expect(manifest.chunks.models[0].entries).toBe(2);
      expect(manifest.chunks.textures[0].entries).toBe(1);
      expect(manifest.chunks.others[0].entries).toBe(0);
      expect(manifest.game).toBe('gta-sa');
    });

    it('restore makes the loader ready (no prompt) when the remembered folder is already granted', async () => {
      const acquireDir = vi.fn(() => Promise.reject(new Error('should not prompt')));
      const local = make({}, { acquireDir, restoreDir: () => Promise.resolve({ handle: DIR, ready: true }) });
      await local.restore();

      await expect(local.init()).resolves.toBeDefined();
      expect(acquireDir).not.toHaveBeenCalled();
    });

    it('load ingests each group into the sink under a per-group synthetic chunk id', async () => {
      const addFiles = vi.fn<AddFiles>();
      const local = make({ sink: { addFiles } });
      await local.prepare();
      await local.load(['models', 'textures']);

      expect(addFiles.mock.calls.map((call) => call[0])).toEqual(['local-models', 'local-textures']);
      expect([...addFiles.mock.calls[0][1]].map(([name]) => name)).toEqual(['cj.dff', 'la.col']);
    });

    it('load ingests the data folder files in the data group', async () => {
      const addFiles = vi.fn<AddFiles>();
      const local = make({ sink: { addFiles } });
      await local.prepare();
      await local.load(['data']);

      expect([...addFiles.mock.calls[0][1]].map(([name]) => name)).toEqual([
        'data/gta.dat',
        'data/maps/test.ide',
        'data/maps/test.ipl',
      ]);
    });

    it('emits progress that reaches 100% (loadedBytes === totalBytes) when a group completes', async () => {
      const local = make({ sink: { addFiles: vi.fn<AddFiles>() } });
      const snapshots: ProgressSnapshot[] = [];
      local.events.on('progress', (snapshot) => snapshots.push(snapshot));
      await local.prepare();
      await local.load(['models']);

      const last = snapshots[snapshots.length - 1];
      expect(last.totalBytes).toBe(2); // models = cj.dff + la.col
      expect(last.loadedBytes).toBe(2);
    });

    it('prepare resolves the directory once (idempotent)', async () => {
      const acquireDir = vi.fn(() => Promise.resolve(DIR));
      const local = make({}, { acquireDir });
      await local.prepare();
      await local.prepare();

      expect(acquireDir).toHaveBeenCalledOnce();
    });
  });
});
