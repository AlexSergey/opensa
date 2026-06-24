/**
 * LOD-generator CLI. Takes `--game <name>`, reads `game-src/<name>/`, and (for now — Phase 0) assembles the map
 * into the cell grid and prints a sizing report. Baking + emitting a build lands with plan 002. Usage:
 * `tsx lod-generator/src/cli.ts --game <name> [--cell <size>]`.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { createGtaSaLodAdapter } from './adapters/gta-sa';
import { printSummary, summarizeCells } from './core';
import { config } from './lod.config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const game = argValue('--game');
  if (!game) {
    throw new Error('usage: tsx lod-generator/src/cli.ts --game <name> [--cell <size>]');
  }

  const root = process.cwd();
  const gameDir = join(root, 'game-src', game);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game-src/${game} not found`);
  }

  const cellSize = Number(argValue('--cell') ?? config.cellSize);
  const adapter = createGtaSaLodAdapter(game, gameDir, { ...config, cellSize });
  printSummary(game, cellSize, summarizeCells(adapter.resolveCells()));
}

main();
