/**
 * File System Access wiring for {@link InstallSource} (plan 053, phase 5). Walks the user-picked raw GTA
 * install once to index every file handle, opens `gta3.img` (+ optional `gta_int.img`) as lazy VER2 archives,
 * and serves loose files on demand. The model/anim archives are excluded from the loose set (their bytes come
 * through the lazy reader / aren't used). Chromium-only.
 */
import type { InstallSource } from './build-vfs';

import { fileHandleSource, openLazyVer2 } from './img-reader';

const GTA3 = 'models/gta3.img';
const GTA_INT = 'models/gta_int.img';
/** Archives served lazily or unused — kept out of the loose-file set. */
const EXCLUDED = new Set(['anim/anim.img', GTA3, GTA_INT]);

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
  const gtaIntHandle = handles.get(GTA_INT);
  const gtaInt = gtaIntHandle ? await openLazyVer2(await fileHandleSource(gtaIntHandle)) : null;

  const loose = [...handles.keys()].filter((path) => !EXCLUDED.has(path) && !path.endsWith('.ds_store'));
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
