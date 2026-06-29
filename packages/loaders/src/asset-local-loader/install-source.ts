/**
 * File System Access wiring for {@link InstallSource} (plan 053, phase 5). Walks the user-picked raw GTA
 * install once to index every file handle, opens `gta3.img` as the primary lazy VER2 archive and **every other
 * `models/*.img`** (gta_int.img + any mod archives the install ships, e.g. our cell-LOD `lods.img`, gostown's
 * `gostown6.img`) merged into one lazy **override** archive, and serves loose files on demand. Mirrors
 * `scripts/build-game.ts`'s `gta3` + `mergeArchives(overrides)` split — otherwise models a mod adds in a separate
 * IMG (like `lod_<cx>_<cy>.dff` in `lods.img`) resolve to nothing and are dropped. Chromium-only.
 */
import type { InstallSource } from './build-vfs';
import type { LazyImgArchive } from './img-reader';

import { fileHandleSource, openLazyVer2 } from './img-reader';

const GTA3 = 'models/gta3.img';
const GTA_INT = 'models/gta_int.img';
const MODEL_IMG = /^models\/[^/]+\.img$/;

/** Build an {@link InstallSource} over a picked install directory (opens the IMG archives lazily). */
export async function browserInstallSource(dir: FileSystemDirectoryHandle): Promise<InstallSource> {
  const handles = new Map<string, FileSystemFileHandle>();
  for await (const file of walkFiles(dir)) {
    handles.set(file.path, file.handle);
  }

  const gta3Handle = handles.get(GTA3);
  if (!gta3Handle) {
    throw new Error('models/gta3.img not found — pick the GTA San Andreas install folder');
  }
  const gta3 = await openLazyVer2(await fileHandleSource(gta3Handle));

  // Every other `models/*.img` is an override (gta_int.img first for precedence, then mod archives like
  // `lods.img`). Merge them so a mod's models resolve — not only gta_int.img's.
  const overridePaths = [...handles.keys()]
    .filter((path) => MODEL_IMG.test(path) && path !== GTA3)
    .sort((a, b) => (a === GTA_INT ? -1 : b === GTA_INT ? 1 : a.localeCompare(b)));
  const overrides: LazyImgArchive[] = [];
  for (const path of overridePaths) {
    overrides.push(await openLazyVer2(await fileHandleSource(handles.get(path)!)));
  }
  const gtaInt = overrides.length > 0 ? mergeLazy(overrides) : null;

  // Archives served lazily or unused (anim) are kept out of the loose-file set.
  const excluded = new Set(['anim/anim.img', ...overridePaths, GTA3]);
  const loose = [...handles.keys()].filter((path) => !excluded.has(path) && !path.endsWith('.ds_store'));
  const readLoose = async (path: string): Promise<Uint8Array> => {
    const handle = handles.get(path);
    if (!handle) {
      throw new Error(`loose file not found: ${path}`);
    }

    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  };

  return {
    gta3,
    gtaInt,
    looseFiles: () => Promise.resolve(loose),
    readLoose,
    readLooseText: async (path) => new TextDecoder().decode(await readLoose(path)),
  };
}

/** Merge lazy archives into one override archive (first archive owning a name wins, like `mergeArchives`). */
function mergeLazy(archives: readonly LazyImgArchive[]): LazyImgArchive {
  const owner = new Map<string, LazyImgArchive>();
  for (const archive of archives) {
    for (const name of archive.names) {
      if (!owner.has(name)) {
        owner.set(name, archive);
      }
    }
  }

  return {
    has: (name) => owner.has(name.toLowerCase()),
    names: [...owner.keys()],
    read: (name) => owner.get(name.toLowerCase())?.read(name) ?? Promise.resolve(null),
  };
}

/** Recursively yield every file handle under `dir` with its lowercased, `/`-joined relative path. */
async function* walkFiles(
  dir: FileSystemDirectoryHandle,
  prefix = '',
): AsyncGenerator<{ handle: FileSystemFileHandle; path: string }> {
  for await (const entry of dir.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      yield { handle: entry, path: path.toLowerCase() };
    } else {
      yield* walkFiles(entry, path);
    }
  }
}
