import type { Cell } from './types';

/** Phase-0 cell statistics — used to size cells + budgets before any baking exists. */
export interface CellSummary {
  cells: number;
  instances: number;
  maxInstancesPerCell: number;
  uniqueModels: number;
}

export function printSummary(game: string, cellSize: number, summary: CellSummary): void {
  console.log(`opensa-lod-generator ${game}:  cellSize=${cellSize}`);
  console.log(`  cells      — ${summary.cells}`);
  console.log(`  instances  — ${summary.instances} HD (${summary.uniqueModels} unique models)`);
  console.log(`  per cell   — up to ${summary.maxInstancesPerCell} instances`);
}

export function summarizeCells(cells: readonly Cell[]): CellSummary {
  const models = new Set<string>();
  let instances = 0;
  let maxInstancesPerCell = 0;
  for (const cell of cells) {
    instances += cell.instances.length;
    maxInstancesPerCell = Math.max(maxInstancesPerCell, cell.instances.length);
    for (const instance of cell.instances) {
      models.add(instance.model);
    }
  }

  return { cells: cells.length, instances, maxInstancesPerCell, uniqueModels: models.size };
}
