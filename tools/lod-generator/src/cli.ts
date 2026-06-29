/**
 * LOD-generator CLI. Takes `--game <path>` (a game-data dir: `gta.dat` + `data/` + `models/`). Without `--out` it
 * assembles the cell grid and prints a sizing report (Phase 0). With `--out <path>` it bakes every cell (merge →
 * decimate → normals → per-cell DFF/TXD) and emits a drop-in build under that directory. `--strip-lods` then
 * removes the stock `lod*` building LODs from that build (the cell-LODs replace them). Usage:
 * `tsx lod-generator/src/cli.ts --game <path> [--cell <size>] [--out <path>] [--strip-lods]`. Paths are relative
 * to the current working directory (absolute paths pass through).
 */
import { statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

import type { BakedCell } from './core';

import { createGtaSaLodAdapter, stripOldLods } from './adapters/gta-sa';
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
  stripLods: boolean,
): void {
  const baked: BakedCell[] = [];
  cells.forEach((cell, i) => {
    baked.push(adapter.bakeCell(cell));
    if ((i + 1) % 25 === 0 || i + 1 === cells.length) {
      console.log(`  baked ${i + 1}/${cells.length} cells`);
    }
  });
  adapter.finalize(outDir, baked);
  if (stripLods) {
    const { entries, instances } = stripOldLods(outDir);
    console.log(`  stripped old lod*: ${instances} instances, ${entries} gta3.img entries`);
  }
  console.log(`→ ${outDir}`);
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  if (!gameArg) {
    throw new Error('usage: tsx lod-generator/src/cli.ts --game <path> [--cell <size>] [--out <path>] [--strip-lods]');
  }

  const gameDir = fromCwd(gameArg);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gameDir}`);
  }
  const label = basename(gameDir);

  const cellSize = Number(argValue('--cell') ?? config.cellSize);
  const adapter = createGtaSaLodAdapter(label, gameDir, { ...config, cellSize });
  const cells = adapter.resolveCells();
  printSummary(label, cellSize, summarizeCells(cells));

  const outArg = argValue('--out');
  if (outArg !== undefined) {
    build(adapter, cells, fromCwd(outArg), process.argv.includes('--strip-lods'));
  }
}

main();
