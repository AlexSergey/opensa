import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { mergeGta3Img } from './img-merge';
import { mergeTxdFolder } from './txd-folder';

/** The one special-cased top-level mod folder — its loose files merge into `gta3.img` instead of being copied. */
const GTA3IMG = 'gta3img';

/**
 * Apply one mod over the current `--out`: overlay every top-level entry except `gta3img/` (recursively — see
 * {@link applyEntry}, which also turns a PNG folder beside a loose `.txd` into a texture merge), then merge the
 * mod's `gta3img/` loose entries into `<out>/models/gta3.img`. Returns the copied-entry + merged-IMG counts.
 */
export function applyMod(modPath: string, outPath: string): { copied: number; merged: number } {
  let copied = 0;
  let merged = 0;
  for (const entry of readdirSync(modPath)) {
    if (entry.toLowerCase() === GTA3IMG) {
      continue;
    }
    const result = applyEntry(join(modPath, entry), join(outPath, entry));
    copied += result.copied;
    merged += result.merged;
  }

  const gta3img = join(modPath, GTA3IMG);
  if (existsSync(gta3img) && statSync(gta3img).isDirectory()) {
    merged += mergeGta3Img(gta3img, join(outPath, 'models', 'gta3.img'));
  }

  return { copied, merged };
}

/**
 * Apply one mod entry over `--out`. A **file** is copied (overwrite). A **directory** whose sibling `<dir>.txd`
 * already exists as a loose file in `--out` is a **texture folder** — its PNGs merge into that `.txd` (add /
 * replace by name) instead of being copied (e.g. `models/generic/vehicle/` → `models/generic/vehicle.txd`).
 * Otherwise it is a plain folder: recurse, copying **files first then subfolders** so a `.txd` this mod also
 * ships is in place before a sibling folder merges into it.
 */
function applyEntry(srcPath: string, dstPath: string): { copied: number; merged: number } {
  if (!statSync(srcPath).isDirectory()) {
    cpSync(srcPath, dstPath, { force: true });

    return { copied: 1, merged: 0 };
  }

  const txdPath = `${dstPath}.txd`;
  if (existsSync(txdPath) && statSync(txdPath).isFile()) {
    return { copied: 0, merged: mergeTxdFolder(srcPath, txdPath) };
  }

  mkdirSync(dstPath, { recursive: true });
  const entries = readdirSync(srcPath, { withFileTypes: true });
  let copied = 0;
  let merged = 0;
  for (const wantDir of [false, true]) {
    for (const entry of entries.filter((e) => e.isDirectory() === wantDir)) {
      const result = applyEntry(join(srcPath, entry.name), join(dstPath, entry.name));
      copied += result.copied;
      merged += result.merged;
    }
  }

  return { copied, merged };
}
