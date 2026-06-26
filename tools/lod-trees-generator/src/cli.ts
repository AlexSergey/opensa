/**
 * lod-trees-generator CLI. Generates GTA-SA-style tree LOD impostors (crossed-billboard cards + a baked alpha
 * atlas) from HD tree models. Usage:
 *   tsx tools/lod-trees-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path> [--tex <px>] [--cards <n>] [--draw <units>]
 *     --dff    HD tree DFF file or directory of them
 *     --txd    the HD models' TXD file or directory of them — textures are baked from here
 *     --out    output directory
 *     --game   game-data dir (gta.dat + data/ + models/gta3.img)
 *     --tex    per-tree atlas texture size in px (default from config)
 *     --cards  crossed billboard cards per tree (default from config)
 *     --draw   impostor LOD draw distance in game units (default from config)
 *     --procobj-max     cap on procobj objects converted to static IPL (0 disables; default from config)
 *     --procobj-height  optional min impostor height (m) gate, drops short clutter (0 = off; default from config)
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
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
  const dffArg = argValue('--dff');
  const txdArg = argValue('--txd');
  const outArg = argValue('--out');
  const gameArg = argValue('--game');

  if (!dffArg || !txdArg || !outArg || !gameArg) {
    throw new Error(
      'usage: tsx tools/lod-trees-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path> [--tex <px>] [--cards <n>]',
    );
  }

  const dffPath = fromCwd(dffArg);
  const txdPath = fromCwd(txdArg);
  const outPath = fromCwd(outArg);
  const gamePath = fromCwd(gameArg);

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
    drawDistance: Number(argValue('--draw') ?? config.drawDistance),
    procObjHeight: Number(argValue('--procobj-height') ?? config.procObjHeight),
    procObjMax: Number(argValue('--procobj-max') ?? config.procObjMax),
    textureSize: Number(argValue('--tex') ?? config.textureSize),
  };

  const loose = process.argv.includes('--loose');
  const strip = process.argv.includes('--strip');

  run(createGtaSaTreeLodAdapter({ config: merged, dffPath, gamePath, loose, outPath, strip, txdPath }), merged);
}

main();
