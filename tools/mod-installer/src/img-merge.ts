import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Set `name → bytes` entries into the `gta3.img` at `imgPath` (add new / replace existing by name), rebuild + write;
 * seeds a fresh archive if `imgPath` is absent. Used both by {@link mergeGta3Img} (a `gta3img/` folder) and by the
 * Modloader baker (scattered `.dff`/`.txd`/`.col`/`.ifp` collected by bare name). Returns the number of entries.
 */
export function injectImgEntries(entries: ReadonlyMap<string, Uint8Array>, imgPath: string): number {
  if (entries.size === 0) {
    return 0;
  }
  const img = existsSync(imgPath) ? openImg(readBytes(imgPath)) : createImg();
  for (const [name, bytes] of entries) {
    img.set(name, bytes);
  }
  writeBytes(imgPath, img.build());

  return entries.size;
}

/**
 * Merge a mod's loose `gta3img/` files into an `gta3.img` archive: `set` each file as an entry (adding new ones,
 * replacing existing by name), then rebuild + write `imgPath`. If `imgPath` doesn't exist yet, the loose files
 * seed a fresh archive. (`gta3img/` is the generic "loose IMG entries" convention a binary `gta3.img` can't be
 * patched file-by-file, so a mod ships a folder.) Returns the number of entries merged.
 */
export function mergeGta3Img(gta3imgDir: string, imgPath: string): number {
  const files = readdirSync(gta3imgDir, { withFileTypes: true }).filter((entry) => entry.isFile());
  const entries = new Map(files.map((file) => [file.name, readBytes(join(gta3imgDir, file.name))]));

  return injectImgEntries(entries, imgPath);
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
