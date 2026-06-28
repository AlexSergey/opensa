import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import { applyPed } from './apply-ped';
import { stripOutput } from './strip';

/** The player / main-character ped (`GAME_CONFIG.mainCharacter`) — always kept when stripping. */
export const DEFAULT_PLAYER = 'BMYPOL1';

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /** The player ped model to always keep when stripping (default {@link DEFAULT_PLAYER}). */
  player?: string;
  /** Reduce the output to ONLY the installed peds (gta3.img + peds.ide), plus the player ped. Default off. */
  strip?: boolean;
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
 * Build the install: wipe `--out`, copy the `--game` base in, then install every ped folder under `--in`
 * (alphabetical — order only matters when two peds touch the same stock model; last wins). Each ped's dff/txd land
 * in `gta3.img`, and a new ped's settings line merges into `peds.ide`.
 *
 * `--strip` (plan 003) wires into the collected keys below in a later phase.
 */
export function install(options: InstallOptions): void {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const peds = readdirSync(inPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
  const imgNames = new Set<string>();
  const models = new Set<string>();
  for (const ped of peds) {
    const applied = applyPed(join(inPath, ped), outPath);
    applied.imgNames.forEach((name) => imgNames.add(name));
    if (applied.model) {
      models.add(applied.model);
    }
  }

  if (options.strip) {
    const player = (options.player ?? DEFAULT_PLAYER).toLowerCase();
    stripOutput(outPath, { imgNames, models, player });
  }

  console.log(
    `ped-installer: ${peds.length} ped(s) → ${outPath} (${imgNames.size} img entries)` +
      (options.strip ? ' [stripped to installed + player]' : ''),
  );
}
