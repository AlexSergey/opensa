import type { RwChunk } from '@opensa/rw-codec/chunk';

import { readRw, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, writeRw } from '@opensa/rw-codec/chunk';
import { readTextureName } from '@opensa/rw-codec/texture-native';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { pngToTextureNative } from './png-texture';

/**
 * Merge a folder of PNGs into an existing loose `.txd`: each `<name>.png` becomes a texture named `<name>` —
 * **replacing** the same-named texture in the dictionary or **adding** a new one, leaving every other texture
 * untouched. Returns the number of PNGs merged. Non-PNG files in the folder are ignored.
 */
export function mergeTxdFolder(folderPath: string, txdPath: string): number {
  const pngs = readdirSync(folderPath, { withFileTypes: true }).filter((e) => e.isFile() && /\.png$/i.test(e.name));
  if (pngs.length === 0) {
    return 0;
  }

  const file = readRw(Uint8Array.from(readFileSync(txdPath)));
  const dict = file.chunks.find((chunk) => chunk.type === RW_TEXTURE_DICTIONARY);
  if (!dict?.children) {
    throw new Error(`not a TXD (no texture-dictionary chunk): ${txdPath}`);
  }
  const byName = new Map<string, RwChunk>();
  for (const native of dict.children.filter((c) => c.type === RW_TEXTURE_NATIVE)) {
    const struct = native.children?.find((c) => c.type === RW_STRUCT)?.data;
    if (struct) {
      byName.set(readTextureName(struct).toLowerCase(), native);
    }
  }

  for (const png of pngs) {
    const name = png.name.replace(/\.png$/i, '');
    const native = pngToTextureNative(name, Uint8Array.from(readFileSync(join(folderPath, png.name))), dict.version);
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      dict.children[dict.children.indexOf(existing)] = native;
    } else {
      insertNative(dict, native);
    }
    byName.set(name.toLowerCase(), native);
  }

  updateTextureCount(dict);
  writeFileSync(txdPath, writeRw(file));

  return pngs.length;
}

/** Insert a new TextureNative after the last existing one (before the dictionary's trailing extension). */
function insertNative(dict: RwChunk, native: RwChunk): void {
  const children = dict.children!;
  let index = children.length;
  for (let i = children.length - 1; i >= 0; i -= 1) {
    if (children[i].type === RW_TEXTURE_NATIVE) {
      index = i + 1;
      break;
    }
  }
  children.splice(index, 0, native);
}

/** Rewrite the dictionary STRUCT's leading `textureCount` (u16) to the current native count. */
function updateTextureCount(dict: RwChunk): void {
  const struct = dict.children?.find((c) => c.type === RW_STRUCT)?.data;
  const count = dict.children?.filter((c) => c.type === RW_TEXTURE_NATIVE).length ?? 0;
  if (struct && struct.length >= 2) {
    new DataView(struct.buffer, struct.byteOffset, struct.byteLength).setUint16(0, count, true);
  }
}
