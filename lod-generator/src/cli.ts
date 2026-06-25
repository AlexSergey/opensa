/**
 * LOD-generator CLI. Takes `--game <name>`, reads `game-src/<name>/`. Without `--build` it assembles the cell
 * grid and prints a sizing report (Phase 0). With `--build` it bakes every cell (merge → decimate → normals →
 * per-cell DFF/TXD) and emits a drop-in build under `out/<name>/`. Usage:
 * `tsx lod-generator/src/cli.ts --game <name> [--cell <size>] [--build]`.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';

import type { BakedCell } from './core';

import { createGtaSaLodAdapter } from './adapters/gta-sa';
import { printSummary, summarizeCells } from './core';
import { config } from './lod.config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function build(
  adapter: ReturnType<typeof createGtaSaLodAdapter>,
  cells: ReturnType<typeof adapter.resolveCells>,
  outDir: string,
): void {
  const baked: BakedCell[] = [];
  cells.forEach((cell, i) => {
    baked.push(adapter.bakeCell(cell));
    if ((i + 1) % 25 === 0 || i + 1 === cells.length) {
      console.log(`  baked ${i + 1}/${cells.length} cells`);
    }
  });
  adapter.finalize(outDir, baked);
  console.log(`→ ${outDir}`);
}

function main(): void {
  const game = argValue('--game');
  if (!game) {
    throw new Error('usage: tsx lod-generator/src/cli.ts --game <name> [--cell <size>] [--build]');
  }

  const root = process.cwd();
  const gameDir = join(root, 'game-src', game);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game-src/${game} not found`);
  }

  const cellSize = Number(argValue('--cell') ?? config.cellSize);
  const adapter = createGtaSaLodAdapter(game, gameDir, { ...config, cellSize });
  const cells = adapter.resolveCells();
  printSummary(game, cellSize, summarizeCells(cells));

  if (process.argv.includes('--build')) {
    build(adapter, cells, join(root, 'lod-generator', 'out', game));
  }
}

main();
