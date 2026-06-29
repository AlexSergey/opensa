/**
 * Map-optimizer CLI. Takes `--game <path>` (a game-data dir: `gta.dat` + `data/` + `models/`), runs the configured
 * model pipeline (and, with `--textures`, the texture mip pass), and emits a full drop-in build under `--out
 * <path>`. `--refine` appends the experimental surface-smoothing pass (plan 014). Usage:
 * `tsx map-optimizer/src/cli.ts --game <path> --out <path> [--textures] [--refine]`. Paths are relative to the
 * current working directory (absolute paths pass through).
 */
import { statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

import { createGtaSaAdapter } from './adapters/gta-sa';
import { printReport, runPipeline, writeReport } from './core';
import { config } from './optimizer.config';
import { createRefineSurface } from './plugins/refine-surface';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  const gameArg = argValue('--game');
  const outArg = argValue('--out');
  if (!gameArg || !outArg) {
    throw new Error('usage: tsx map-optimizer/src/cli.ts --game <path> --out <path> [--textures] [--refine]');
  }

  const gameDir = fromCwd(gameArg);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gameDir}`);
  }

  const outDir = fromCwd(outArg);
  const adapter = createGtaSaAdapter(basename(gameDir), gameDir);

  // Texture mip pass (opt-in). Runs before the model run so both end up in the one finalized build.
  if (process.argv.includes('--textures')) {
    optimizeTextures(adapter);
  }

  // `--refine` (opt-in, experimental — plan 014) appends surface smoothing as the last model stage.
  const plugins = process.argv.includes('--refine') ? [...config.plugins, createRefineSurface()] : config.plugins;
  const report = await runPipeline(adapter, { ...config, plugins }, outDir);
  printReport(report);
  writeReport(report);
}

function optimizeTextures(adapter: ReturnType<typeof createGtaSaAdapter>): void {
  let processed = 0;
  let mipped = 0;
  let failed = 0;
  let missing = 0;
  for (const name of adapter.resolveTextures()) {
    const result = adapter.optimizeTexture(name);
    if (!result) {
      missing += 1;
    } else if (result.failed) {
      failed += 1; // unparseable TXD — skipped, run continues
    } else {
      processed += 1;
      mipped += result.mipped;
    }
  }
  console.log(
    `  textures — ${processed} TXD processed, ${mipped} textures mipped, ${failed} failed, ${missing} not found`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
