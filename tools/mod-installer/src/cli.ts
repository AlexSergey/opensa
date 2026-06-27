/**
 * mod-installer CLI. Layers GTA-SA mod folders onto a base game. Usage:
 *   tsx tools/mod-installer/src/cli.ts --game <path> --in <mods-dir> --out <path>
 *     --game  base game tree (gta.dat + data/ + models/gta3.img …)
 *     --in    folder of mods (each an immediate subfolder mirroring the game tree, with an optional `gta3img/`)
 *     --out   output install dir (wiped + rebuilt each run)
 *   Mods are applied alphabetically: plain files overwrite, `gta3img/` entries merge into `gta3.img`.
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
    throw new Error('usage: tsx tools/mod-installer/src/cli.ts --game <path> --in <mods-dir> --out <path>');
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

  install({ gamePath, inPath, outPath });
}

main();
