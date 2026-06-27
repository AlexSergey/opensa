/**
 * lod-procobj-generator CLI. Converts GTA-SA procobj scatter species into static IPL instances with
 * simplified-copy (decimated) LODs. Usage:
 *   tsx tools/lod-procobj-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path>
 *     --dff     procobj HD DFF file or directory (intersected with procobj.dat to pick the species)
 *     --txd     the HD models' TXD(s) — LOD textures are downscaled from here, falling back to the stock game TXD
 *     --out     output drop-in directory
 *     --game    game-data dir (gta.dat + data/ + models/gta3.img)
 *     --tris    QEM target triangles per LOD model (default from config)
 *     --tex     LOD texture max size px (default from config)
 *     --draw    LOD draw distance in game units (default from config)
 *     --max     cap on converted procobj objects (0 disables; default from config)
 *     --height  optional min HD height (m) gate, drops short clutter (0 = off; default from config)
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
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
  const dffArg = argValue('--dff');
  const txdArg = argValue('--txd');
  const outArg = argValue('--out');
  const gameArg = argValue('--game');

  if (!dffArg || !txdArg || !outArg || !gameArg) {
    throw new Error(
      'usage: tsx tools/lod-procobj-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path>',
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
    drawDistance: Number(argValue('--draw') ?? config.drawDistance),
    procObjHeight: Number(argValue('--height') ?? config.procObjHeight),
    procObjMax: Number(argValue('--max') ?? config.procObjMax),
    textureSize: Number(argValue('--tex') ?? config.textureSize),
    tris: Number(argValue('--tris') ?? config.tris),
  };

  run({ config: merged, dffPath, gamePath, outPath, txdPath });
}

main();
