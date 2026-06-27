import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { mergeGta3Img } from './img-merge';

/** The one special-cased mod folder — its loose files merge into `gta3.img` instead of being copied. */
const GTA3IMG = 'gta3img';

/**
 * Apply one mod over the current `--out`: copy **every** top-level entry except `gta3img/` (files + folders like
 * `data/`, `models/`, `text/`, …) on top, overwriting matching files but keeping the rest (overlay); then merge
 * the mod's `gta3img/` loose entries into `<out>/models/gta3.img` (after the file copy, so they land on whichever
 * `gta3.img` this mod ships or the inherited one). Returns the count of copied entries + merged IMG entries.
 */
export function applyMod(modPath: string, outPath: string): { copied: number; merged: number } {
  let copied = 0;
  for (const entry of readdirSync(modPath)) {
    if (entry.toLowerCase() === GTA3IMG) {
      continue;
    }
    cpSync(join(modPath, entry), join(outPath, entry), { force: true, recursive: true });
    copied += 1;
  }

  const gta3img = join(modPath, GTA3IMG);
  const merged =
    existsSync(gta3img) && statSync(gta3img).isDirectory()
      ? mergeGta3Img(gta3img, join(outPath, 'models', 'gta3.img'))
      : 0;

  return { copied, merged };
}
