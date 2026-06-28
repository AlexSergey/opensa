import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Place a ped folder's `.dff` + `.txd` files into `gta3.img`, **replacing by name** (adding if new), then rebuild
 * + write the archive. A ped ships just its model `<model>.dff` and texture dictionary `<model>.txd` (no extra
 * numbered txds — that's a vehicle paintjob thing). Returns the lowercased entry names written (used by `--strip`).
 * Seeds a fresh archive if `imgPath` doesn't exist yet.
 */
export function mergePedImg(folderPath: string, imgPath: string): string[] {
  const files = readdirSync(folderPath, { withFileTypes: true }).filter(
    (entry) => entry.isFile() && /\.(?:dff|txd)$/i.test(entry.name),
  );
  if (files.length === 0) {
    return [];
  }
  const img = existsSync(imgPath) ? openImg(readBytes(imgPath)) : createImg();
  for (const file of files) {
    img.set(file.name, readBytes(join(folderPath, file.name)));
  }
  mkdirSync(dirname(imgPath), { recursive: true });
  writeFileSync(imgPath, img.build());

  return files.map((file) => file.name.toLowerCase());
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
