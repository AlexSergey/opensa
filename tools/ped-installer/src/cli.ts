/**
 * ped-installer CLI. Installs GTA-SA ped mod folders onto a base game. Usage:
 *   tsx tools/ped-installer/src/cli.ts --game <path> --in <peds-dir> --out <path>
 *     --game  base game tree (gta.dat + data/ + models/gta3.img …)
 *     --in    folder of peds (each an immediate subfolder: <model>.dff/.txd [+ <model>.settings.txt])
 *     --out   output install dir (wiped + rebuilt each run)
 *     --strip  (optional, off by default) reduce gta3.img + peds.ide to ONLY the installed peds (+ the player ped)
 *     --player (optional) the player ped model to keep when stripping (default BMYPOL1)
 *   Per ped: dff/txd go into gta3.img (replace by name); a new ped's settings line is merged into peds.ide.
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { install } from './install';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  const inArg = argValue('--in');
  const outArg = argValue('--out');

  if (!gameArg || !inArg || !outArg) {
    throw new Error('usage: tsx tools/ped-installer/src/cli.ts --game <path> --in <peds-dir> --out <path>');
  }

  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(inArg);
  const outPath = fromCwd(outArg);

  if (!statSync(gamePath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a directory: ${gamePath}`);
  }
  if (!statSync(inPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--in must be a directory: ${inPath}`);
  }

  install({
    gamePath,
    inPath,
    outPath,
    player: argValue('--player'),
    strip: process.argv.includes('--strip'),
  });
}

main();
