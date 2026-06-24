import type { LodAdapter } from '../../core/adapter';
import type { BakedCell, Cell, LodConfig } from '../../core/types';

import { resolveCells } from './resolve';

/**
 * GTA-SA (RenderWare) LOD adapter. Phase 0 (assemble HD instances → cell grid) is implemented via read-only
 * reuse of the engine's IDE/IPL parsers. The bake (merge → QEM decimate → texture atlas → emit) lands across
 * plan 002's phases; until then `bakeCell` / `finalize` throw so callers can't silently produce an empty build.
 */
export function createGtaSaLodAdapter(game: string, gameDir: string, config: LodConfig): LodAdapter {
  return {
    bakeCell(cell: Cell): BakedCell {
      throw new Error(`bakeCell not implemented yet (plan 002, Phases 1–2): cell ${cell.cx},${cell.cy}`);
    },
    finalize(outDir: string, baked: readonly BakedCell[]): void {
      throw new Error(`finalize not implemented yet (plan 002, Phase 3): ${baked.length} cells → ${outDir}`);
    },
    game,
    resolveCells(): Cell[] {
      return resolveCells(gameDir, config.cellSize);
    },
  };
}
