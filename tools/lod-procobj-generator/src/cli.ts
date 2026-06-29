/**
 * lod-procobj-generator CLI. Converts GTA-SA procobj scatter species into static IPL instances with
 * simplified-copy (decimated) LODs. Usage:
 *   tsx tools/lod-procobj-generator/src/cli.ts --out <path> --game <path> [--in <dir>]
 *     --in      optional folder holding the HD procobj models (`<model>.dff` + `<model>.txd`), intersected with
 *               procobj.dat to pick the species; when omitted, **all** procobj.dat species are converted straight
 *               from the game's own gta3.img (no model/texture swap)
 *     --out     output drop-in directory
 *     --game    game-data dir (gta.dat + data/ + models/gta3.img)
 *     --tris    QEM target triangles per LOD model (default from config)
 *     --tex     LOD texture max size px (default from config)
 *     --draw    LOD draw distance in game units (default from config)
 *     --max     cap on converted procobj objects (0 disables; default from config)
 *     --height  optional min HD height (m) gate, drops short clutter (0 = off; default from config)
 *     --prelight [info]  copy the stock model's trunk prelight onto each LOD (and swapped HD with `--in`); foliage
 *                        kept. Optionally pass `--prelight ./info.json` of per-model `{ "<model>": { "skip": true } }`
 *                        overrides to opt a model out of the transfer.
 *     --loose   write the changed IMG entries loose to `<out>/gta3img/` instead of repacking `<out>/models/gta3.img`
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { parsePrelightInfo, type PrelightInfo } from '@opensa/sa-lod/prelight';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { run } from './build';
import { config } from './config';

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
    throw new Error('usage: tsx tools/lod-procobj-generator/src/cli.ts --out <path> --game <path> [--in <dir>]');
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
    drawDistance: Number(argValue('--draw') ?? config.drawDistance),
    procObjHeight: Number(argValue('--height') ?? config.procObjHeight),
    procObjMax: Number(argValue('--max') ?? config.procObjMax),
    textureSize: Number(argValue('--tex') ?? config.textureSize),
    tris: Number(argValue('--tris') ?? config.tris),
  };

  const loose = process.argv.includes('--loose');
  const prelight = process.argv.includes('--prelight');

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

  run({ config: merged, gamePath, inPath, loose, outPath, prelight, prelightInfo });
}

main();
