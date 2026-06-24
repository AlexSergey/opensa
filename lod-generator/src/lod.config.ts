import type { LodConfig } from './core/types';

/**
 * Default run config. `cellSize` **must match the engine's streaming grid** (`world-grid.ts` / the world
 * adapter's `cellSize`) so each baked LOD maps to exactly one engine cell — see plan 002 "Engine fit". Tune the
 * cell size + (later) decimation/atlas budgets from the Phase-0 report.
 */
export const config: LodConfig = {
  cellSize: 256,
};
