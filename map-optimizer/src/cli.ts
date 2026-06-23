/**
 * Map-optimizer CLI. Mirrors `scripts/build-game.ts`: takes `--game <name>`, reads `game-src/<name>/`, runs
 * the configured pipeline over the map's models, and writes the results under `map-optimizer/out/<name>/`.
 * Usage: `tsx map-optimizer/src/cli.ts --game <name>`.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { createGtaSaAdapter } from '../adapters/gta-sa';
import { printReport, runPipeline } from '../core';
import { config } from '../optimizer.config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const game = argValue('--game');
  if (!game) {
    throw new Error('usage: tsx map-optimizer/src/cli.ts --game <name>');
  }

  const root = process.cwd();
  const gameDir = join(root, 'game-src', game);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game-src/${game} not found`);
  }

  const outDir = config.out ?? join(root, 'map-optimizer', 'out', game);
  const adapter = createGtaSaAdapter(game, gameDir);
  printReport(await runPipeline(adapter, config, outDir));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
