/**
 * lod-trees-generator CLI. Generates GTA-SA-style tree LOD impostors (crossed-billboard cards + a baked alpha
 * atlas) from HD tree models. Usage:
 *   tsx tools/lod-trees-generator/src/cli.ts --out <path> --game <path> [--in <dir>] [--tex <px>] [--cards <n>] [--draw <units>]
 *     --in     optional folder of HD trees (`<model>.dff` + `<model>.txd`); omit to bake the built-in SA tree
 *              roster straight from the game's `gta3.img` (no model/texture swap)
 *     --out    output directory
 *     --game   game-data dir (gta.dat + data/ + models/gta3.img)
 *     --tex    per-tree atlas texture size in px (default from config)
 *     --cards  crossed billboard cards per tree (default from config)
 *     --draw   impostor LOD draw distance in game units (default from config)
 *     --prelight [info]  copy the stock model's trunk prelight onto each swapped tree (HD + baked LOD; foliage kept).
 *                        Optionally pass a JSON file (`--prelight ./info.json`) of per-model overrides, e.g.
 *                        `{ "tree_hipoly09b": { "skip": true } }` to opt that model out of the prelight transfer.
 *     --loose           write changed IMG entries loose to `<out>/gta3img/` instead of repacking `gta3.img`
 *     --strip           verification mode: strip all source trees from the map (empty world) instead of placing
 *     --debug-png       also write a per-impostor PNG preview of each baked card atlas to `<out>` (default off)
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { parsePrelightInfo, type PrelightInfo } from '@opensa/sa-lod/prelight';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { createGtaSaTreeLodAdapter } from './adapters/gta-sa';
import { config } from './config';
import { run } from './core';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const inArg = argValue('--in');
  const outArg = argValue('--out');
  const gameArg = argValue('--game');

  if (!outArg || !gameArg) {
    throw new Error(
      'usage: tsx tools/lod-trees-generator/src/cli.ts --out <path> --game <path> [--in <dir>] [--tex <px>] [--cards <n>]',
    );
  }

  const inPath = inArg === undefined ? undefined : fromCwd(inArg);
  const outPath = fromCwd(outArg);
  const gamePath = fromCwd(gameArg);

  if (inPath !== undefined && !existsSync(inPath)) {
    throw new Error(`--in not found: ${inPath}`);
  }
  if (!statSync(gamePath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gamePath}`);
  }
  mkdirSync(outPath, { recursive: true });

  const merged = {
    ...config,
    cards: Number(argValue('--cards') ?? config.cards),
    drawDistance: Number(argValue('--draw') ?? config.drawDistance),
    textureSize: Number(argValue('--tex') ?? config.textureSize),
  };

  const debugPng = process.argv.includes('--debug-png');
  const loose = process.argv.includes('--loose');
  const prelight = process.argv.includes('--prelight');
  const strip = process.argv.includes('--strip');

  // `--prelight` is a bare flag, OR `--prelight <info.json>` of per-model overrides (a following non-flag token).
  const prelightArg = argValue('--prelight');
  let prelightInfo: PrelightInfo | undefined;
  if (prelight && prelightArg !== undefined && !prelightArg.startsWith('--')) {
    const file = fromCwd(prelightArg);
    if (!existsSync(file)) {
      throw new Error(`--prelight info file not found: ${file}`);
    }
    prelightInfo = parsePrelightInfo(readFileSync(file, 'utf8'));
  }

  run(
    createGtaSaTreeLodAdapter({
      config: merged,
      debugPng,
      gamePath,
      inPath,
      loose,
      outPath,
      prelight,
      prelightInfo,
      strip,
    }),
    merged,
  );
}

main();
