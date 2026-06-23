/**
 * Map-optimizer CLI. Mirrors `scripts/build-game.ts`: takes `--game <name>`, reads `game-src/<name>/`, runs
 * the configured model pipeline (and, with `--textures`, the texture mip pass), and emits a full drop-in
 * build under `map-optimizer/out/<name>/`. Usage: `tsx map-optimizer/src/cli.ts --game <name> [--textures]`.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { createGtaSaAdapter } from './adapters/gta-sa';
import { printReport, runPipeline, writeReport } from './core';
import { config } from './optimizer.config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const game = argValue('--game');
  if (!game) {
    throw new Error('usage: tsx map-optimizer/src/cli.ts --game <name> [--textures]');
  }

  const root = process.cwd();
  const gameDir = join(root, 'game-src', game);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game-src/${game} not found`);
  }

  const outDir = config.out ?? join(root, 'map-optimizer', 'out', game);
  const adapter = createGtaSaAdapter(game, gameDir);

  // Texture mip pass (opt-in). Runs before the model run so both end up in the one finalized build.
  if (process.argv.includes('--textures')) {
    optimizeTextures(adapter);
  }

  const report = await runPipeline(adapter, config, outDir);
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
