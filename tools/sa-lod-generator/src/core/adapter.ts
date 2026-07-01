import type { BuildStats } from '../adapters/gta-sa/finalize';
import type { SizingReport } from './report';
import type { ResolveResult } from './types';

/**
 * Per-game contract for sa-lod-generator (mirrors the map-optimizer / opensa-lod-generator adapter split). All
 * game-specific I/O lives behind this. Phase 1 (`docs/plans/002`): `resolvePairs` + `report` (sizing) and
 * `finalize` (clone every per-object LOD from its HD + 50 % TXD, drop-in into `outDir`).
 */
export interface SaLodAdapter {
  /** Emit the drop-in clone-LOD build under `outDir` for a resolved set; returns the bake counts. */
  finalize(outDir: string, resolved: ResolveResult): BuildStats;
  /** Identifier of the game this adapter serves (e.g. `non-modified`). */
  readonly game: string;
  /** Sizing report (LOD counts + stock-vs-clone triangle budgets) for a resolved set — read-only. */
  report(resolved: ResolveResult): SizingReport;
  /** Resolve the map's HD↔LOD links from the IPL `lod` field (read-only reuse of the engine parsers). */
  resolvePairs(): ResolveResult;
}
