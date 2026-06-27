import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import { applyMod } from './apply-mod';

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
}

/**
 * Build a merged install: wipe `--out`, copy the `--game` base into it, then apply every mod folder under `--in`
 * (alphabetical) on top — plain files overwrite, `gta3img/` entries merge into `gta3.img`. Later mods win.
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
  for (const mod of mods) {
    merged += applyMod(join(inPath, mod), outPath).merged;
  }

  console.log(`mod-installer: ${mods.length} mod(s) → ${outPath} (${merged} gta3.img entries merged)`);
}

/** Mod folder names sorted plain case-insensitive ascending (`mod1`, `mod10`, `mod2` — **not** numeric-aware). */
export function sortMods(names: readonly string[]): string[] {
  return [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
}

/** Refuse to wipe a dangerous `--out` — the filesystem root, or a path that is (or contains) `--game` / `--in`. */
function guardOut(outPath: string, gamePath: string, inPath: string): void {
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
