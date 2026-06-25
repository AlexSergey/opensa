import { expect, test } from '@playwright/test';

/**
 * E2E for the local loader (`src/loaders/asset-local-loader/**`) running in a real browser: it converts a
 * raw GTA install (a fake File System Access directory tree built in-page) into the real {@link Vfs} and
 * verifies the result. The folder PICKER (`showDirectoryPicker`) is a native dialog Playwright can't drive,
 * so `acquireDir` is injected to return the fake root — but `browserInstallSource` (the directory walk + lazy
 * VER2 reader) and the whole selection/ingest pipeline run for real. Runs on the Vite origin so `import('/src/
 * ...')` resolves. IndexedDB handle persistence is unit-tested separately (real handles aren't synthesisable).
 */
const ALL = '/packages/loaders/src/asset-local-loader/asset-local-loader.ts';
const INSTALL = '/packages/loaders/src/asset-local-loader/install-source.ts';
const ARCHIVE = '/packages/renderware/src/archive/img-archive.ts';
const VFS = '/packages/vfs/src/vfs.ts';

const IDE = ['objs', '100, cj, cjtxd, 100, 0', '200, tree, treetxd, 80, 0', 'end'].join('\n');
const IPL = ['inst', '100, cj, 0, 0, 0, 0, 0, 0, 0, 1, 0', 'end'].join('\n');

test.describe('local loader', () => {
  test('converts a raw install (fake FSA tree) into the VFS and verifies complete', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(
      async ({ all, archive, ide, install, ipl, vfsModule }) => {
        interface FakeFile {
          arrayBuffer(): Promise<ArrayBuffer>;
          size: number;
          slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
        }
        interface FakeHandle {
          getFile?(): Promise<FakeFile>;
          kind: string;
          name: string;
          values?(): AsyncGenerator<FakeHandle>;
        }
        interface ArchiveModule {
          buildVer2Buffer(entries: { data: Uint8Array; name: string }[]): Uint8Array;
        }
        interface InstallModule {
          browserInstallSource(dir: FileSystemDirectoryHandle): Promise<unknown>;
        }
        interface LocalLoaderModule {
          AssetLocalLoader: new (
            config: { game: string; sink: unknown; version: string },
            deps: {
              acquireDir: (stored: FileSystemDirectoryHandle | null) => Promise<FileSystemDirectoryHandle>;
              openSource: (dir: FileSystemDirectoryHandle) => Promise<unknown>;
              restoreDir: () => Promise<{ handle: FileSystemDirectoryHandle | null; ready: boolean }>;
            },
          ) => { init(): Promise<unknown>; load(): Promise<void>; prepare(): Promise<void> };
        }
        interface VfsModule {
          Vfs: new () => { names: string[]; verify(manifest: unknown): string[] };
        }

        const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
        const range = (bytes: Uint8Array, start: number, end: number): ArrayBuffer => bytes.slice(start, end).buffer;
        const fileFrom = (bytes: Uint8Array): FakeFile => ({
          arrayBuffer: () => Promise.resolve(range(bytes, 0, bytes.length)),
          size: bytes.length,
          slice: (start, end) => ({ arrayBuffer: () => Promise.resolve(range(bytes, start, end)) }),
        });
        const fileHandle = (name: string, bytes: Uint8Array): FakeHandle => ({
          getFile: () => Promise.resolve(fileFrom(bytes)),
          kind: 'file',
          name,
        });
        const dirHandle = (name: string, children: FakeHandle[]): FakeHandle => ({
          kind: 'directory',
          name,
          // eslint-disable-next-line @typescript-eslint/require-await -- async generator to match FSA's values()
          values: async function* (): AsyncGenerator<FakeHandle> {
            for (const child of children) {
              yield child;
            }
          },
        });

        const archiveMod = (await import(/* @vite-ignore */ archive)) as ArchiveModule;
        const installMod = (await import(/* @vite-ignore */ install)) as InstallModule;
        const localMod = (await import(/* @vite-ignore */ all)) as LocalLoaderModule;
        const vfsMod = (await import(/* @vite-ignore */ vfsModule)) as VfsModule;

        const gta3 = archiveMod.buildVer2Buffer([
          { data: new Uint8Array([1, 2, 3]), name: 'cj.dff' },
          { data: new Uint8Array([4, 5]), name: 'cjtxd.txd' },
          { data: new Uint8Array([6]), name: 'la.col' },
          { data: new Uint8Array([7]), name: 'tree.dff' }, // referenced but NOT placed → dropped
        ]);
        const root = dirHandle('gta-sa', [
          dirHandle('models', [fileHandle('gta3.img', gta3)]),
          dirHandle('data', [
            fileHandle('gta.dat', enc('')),
            dirHandle('maps', [fileHandle('test.ide', enc(ide)), fileHandle('test.ipl', enc(ipl))]),
          ]),
        ]) as unknown as FileSystemDirectoryHandle;

        const vfs = new vfsMod.Vfs();
        const loader = new localMod.AssetLocalLoader(
          { game: 'gta-sa', sink: vfs, version: '1.0.0' },
          {
            acquireDir: (): Promise<FileSystemDirectoryHandle> => Promise.resolve(root),
            openSource: (dir): Promise<unknown> => installMod.browserInstallSource(dir),
            restoreDir: (): Promise<{ handle: FileSystemDirectoryHandle | null; ready: boolean }> =>
              Promise.resolve({ handle: null, ready: false }),
          },
        );
        await loader.prepare();
        const manifest = await loader.init();
        await loader.load();

        return { names: [...vfs.names].sort(), problems: vfs.verify(manifest) };
      },
      { all: ALL, archive: ARCHIVE, ide: IDE, install: INSTALL, ipl: IPL, vfsModule: VFS },
    );

    // Placed model cj + its txd (bare names) + the world file + the loose data files; tree.dff dropped.
    expect(result.names).toEqual([
      'cj.dff',
      'cjtxd.txd',
      'data/gta.dat',
      'data/maps/test.ide',
      'data/maps/test.ipl',
      'la.col',
    ]);
    expect(result.problems).toEqual([]);
  });
});
