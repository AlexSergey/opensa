import type { BakedCell, Cell } from './types';

/**
 * Per-game contract for the LOD generator (mirrors map-optimizer's adapter split). All game-specific I/O lives
 * behind this: assembling the world into cells (read-only reuse of the engine's parsers), baking a cell into a
 * LOD mesh + atlas, and emitting the build (DFFs / TXDs / IPL, stripping old LODs). The core pipeline only sees
 * these three steps, so a new game is a new adapter — no core change.
 */
export interface LodAdapter {
  /** Bake one cell into a merged + decimated LOD mesh + texture atlas (plan 002, Phases 1–2). */
  bakeCell(cell: Cell): BakedCell;
  /** Emit the build to `outDir`: cell DFFs + atlas TXDs + IPL, and strip the old LODs (plan 002, Phase 3). */
  finalize(outDir: string, baked: readonly BakedCell[]): void;
  /** Identifier of the game this adapter serves (e.g. `original`). */
  readonly game: string;
  /** Assemble the map's HD instances into the square cell grid (Phase 0 — read-only). */
  resolveCells(): Cell[];
}
