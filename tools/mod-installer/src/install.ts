import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import { applyMod } from './apply-mod';
import { bakeMod } from './bake-mod';

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
}

/** Refuse to wipe a dangerous `--out` — the filesystem root, or a path that is (or contains) `--game` / `--in`. */
export function guardOut(outPath: string, gamePath: string, inPath: string): void {
  if (outPath === parse(outPath).root) {
    throw new Error(`refusing to wipe the filesystem root as --out: ${outPath}`);
  }
  if (outPath === gamePath || outPath === inPath) {
    throw new Error(`--out must differ from --game and --in: ${outPath}`);
  }
  if (gamePath.startsWith(outPath + sep) || inPath.startsWith(outPath + sep)) {
    throw new Error(`--out must not contain --game or --in (would wipe them): ${outPath}`);
  }
}

/**
 * Build a merged install: wipe `--out`, copy the `--game` base into it, then apply every mod folder under `--in`
 * (alphabetical) on top. A mod carrying a **loader file** (a `loader.txt`-style mod) is **baked** — its loader's
 * defs/placements are registered in `gta.dat`, its scattered assets injected into `gta3.img`, its data files merged
 * ({@link bakeMod}); every other mod is a plain **overlay** (files overwrite, `gta3img/`/PNG-folders merge). Later
 * mods win.
 */
export function install(options: InstallOptions): void {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const mods = sortMods(
    readdirSync(inPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  let merged = 0;
  let baked = 0;
  for (const mod of mods) {
    const bake = bakeMod(join(inPath, mod), outPath);
    if (bake.baked) {
      merged += bake.assets;
      baked += 1;
    } else {
      merged += applyMod(join(inPath, mod), outPath).merged;
    }
  }

  console.log(
    `mod-installer: ${mods.length} mod(s) (${baked} baked) → ${outPath} ` +
      `(${merged} entries merged into gta3.img / loose .txd)`,
  );
}

/** Mod folder names sorted plain case-insensitive ascending (`mod1`, `mod10`, `mod2` — **not** numeric-aware). */
export function sortMods(names: readonly string[]): string[] {
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
}
