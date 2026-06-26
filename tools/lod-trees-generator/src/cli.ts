/**
 * lod-trees-generator CLI. Generates GTA-SA-style tree LOD impostors (crossed-billboard cards + a baked alpha
 * atlas) from HD tree models. Usage:
 *   tsx tools/lod-trees-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path> [--tex <px>] [--cards <n>]
 *     --dff    HD tree DFF file or directory of them (relative to the lod-trees-generator folder)
 *     --txd    the HD models' TXD file or directory of them — textures are baked from here (relative to the tool)
 *     --out    output directory (relative to the lod-trees-generator folder)
 *     --game   game-data dir (gta.dat / IMG), relative to cwd — sources a structural LOD template only
 *     --tex    per-tree atlas texture size in px (default from config)
 *     --cards  crossed billboard cards per tree (default from config)
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { createGtaSaTreeLodAdapter } from './adapters/gta-sa';
import { config } from './config';
import { run } from './core';

const TOOL_ROOT = join(__dirname, '..'); // tools/lod-trees-generator

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const dffArg = argValue('--dff');
  const txdArg = argValue('--txd');
  const outArg = argValue('--out');
  const gameArg = argValue('--game');

  if (!dffArg || !txdArg || !outArg || !gameArg) {
    throw new Error(
      'usage: tsx tools/lod-trees-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path> [--tex <px>] [--cards <n>]',
    );
  }

  const dffPath = resolveFrom(TOOL_ROOT, dffArg);
  const txdPath = resolveFrom(TOOL_ROOT, txdArg);
  const outPath = resolveFrom(TOOL_ROOT, outArg);
  const gamePath = resolveFrom(process.cwd(), gameArg);

  if (!existsSync(dffPath)) {
    throw new Error(`--dff not found: ${dffPath}`);
  }
  if (!existsSync(txdPath)) {
    throw new Error(`--txd not found: ${txdPath}`);
  }
  if (!statSync(gamePath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gamePath}`);
  }
  mkdirSync(outPath, { recursive: true });

  const merged = {
    ...config,
    cards: Number(argValue('--cards') ?? config.cards),
    textureSize: Number(argValue('--tex') ?? config.textureSize),
  };

  run(createGtaSaTreeLodAdapter({ config: merged, dffPath, gamePath, outPath, txdPath }), merged);
}

function resolveFrom(base: string, value: string): string {
  return isAbsolute(value) ? value : resolve(base, value);
}

main();
