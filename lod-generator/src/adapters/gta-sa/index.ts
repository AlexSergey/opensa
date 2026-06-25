import { join } from 'node:path';

import type { LodAdapter } from '../../core/adapter';
import type { BakedCell, Cell, LodConfig } from '../../core/types';

import { decimateMesh } from './decimate';
import { writeBuild } from './finalize';
import { openArchives } from './io';
import { mergeCell } from './merge';
import { createModelSource } from './model-source';
import { rebuildMeshNormals } from './normals';
import { maxObjectId, resolveCells } from './resolve';
import { createTextureSource } from './texture-source';

/**
 * GTA-SA (RenderWare) LOD adapter. Phase 0 (assemble HD instances → cell grid) + Phase 1's merge (HD geometry →
 * one cell-relative mesh by texture) are implemented via read-only reuse of the engine's parsers. QEM decimation,
 * the texture atlas (Phase 1.1 / 2) and the build emit (`finalize`, Phase 3) land next; until then `finalize`
 * throws so callers can't silently produce an empty build. Archives are opened once and shared.
 */
export function createGtaSaLodAdapter(game: string, gameDir: string, config: LodConfig): LodAdapter {
  const archives = openArchives(join(gameDir, 'models'));
  const source = createModelSource(archives);
  const textureSource = createTextureSource(archives);

  return {
    bakeCell(cell: Cell): BakedCell {
      const merged = mergeCell(cell, config.cellSize, source);
      const decimated = decimateMesh(merged, config.decimateTargetTriangles);
      const mesh = rebuildMeshNormals(decimated); // re-derived on the final (decimated) cell mesh

      return { cx: cell.cx, cy: cell.cy, mesh };
    },
    finalize(outDir: string, baked: readonly BakedCell[]): void {
      writeBuild({
        baked,
        cellSize: config.cellSize,
        drawDistance: config.lodDrawDistance,
        firstId: maxObjectId(gameDir) + 1,
        gameDir,
        lodTextureSize: config.lodTextureSize,
        outDir,
        textureSource,
      });
    },
    game,
    resolveCells(): Cell[] {
      return resolveCells(gameDir, archives, config.cellSize);
    },
  };
}
