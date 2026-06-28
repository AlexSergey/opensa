import { cpSync, readdirSync, rmSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';

import { applyVehicle } from './apply-vehicle';
import { stripOutput } from './strip';

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /** Reduce the output to ONLY the installed vehicles (gta3.img + the four data files). Default off. */
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
 * Build the install: wipe `--out`, copy the `--game` base in, then install every vehicle folder under `--in`
 * (alphabetical — order only matters when two vehicles touch the same stock model; last wins). Each vehicle's
 * dff/txd land in `gta3.img` and its settings merge into the four data files.
 */
export function install(options: InstallOptions): void {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { force: true, recursive: true });

  const vehicles = readdirSync(inPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'));
  const imgNames = new Set<string>();
  const models = new Set<string>();
  const handlingIds = new Set<string>();
  for (const vehicle of vehicles) {
    const applied = applyVehicle(join(inPath, vehicle), outPath);
    applied.imgNames.forEach((name) => imgNames.add(name));
    if (applied.model) {
      models.add(applied.model);
    }
    if (applied.handlingId) {
      handlingIds.add(applied.handlingId);
    }
  }

  if (options.strip) {
    stripOutput(outPath, { handlingIds, imgNames, models });
  }

  console.log(
    `vehicle-installer: ${vehicles.length} vehicle(s) → ${outPath} (${imgNames.size} img entries)` +
      (options.strip ? ' [stripped to installed]' : ''),
  );
}
