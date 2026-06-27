import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Merge a mod's loose `gta3img/` files into an `gta3.img` archive: `set` each file as an entry (adding new ones,
 * replacing existing by name), then rebuild + write `imgPath`. If `imgPath` doesn't exist yet, the loose files
 * seed a fresh archive. The inverse of a `--loose` IMG drop. Returns the number of entries merged.
 */
export function mergeGta3Img(gta3imgDir: string, imgPath: string): number {
  const files = readdirSync(gta3imgDir, { withFileTypes: true }).filter((entry) => entry.isFile());
  if (files.length === 0) {
    return 0;
  }
  const img = existsSync(imgPath) ? openImg(readBytes(imgPath)) : createImg();
  for (const file of files) {
    img.set(file.name, readBytes(join(gta3imgDir, file.name)));
  }
  writeBytes(imgPath, img.build());

  return files.length;
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
