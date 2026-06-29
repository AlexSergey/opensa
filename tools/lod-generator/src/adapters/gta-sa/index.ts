import { decimateMesh } from '@opensa/sa-lod/decimate';
import { createModelSource } from '@opensa/sa-lod/model-source';
import { rebuildMeshNormals } from '@opensa/sa-lod/normals';
import { createTextureSource } from '@opensa/sa-lod/texture-source';
import { join } from 'node:path';

import type { LodAdapter } from '../../core/adapter';
import type { BakedCell, Cell, LodConfig } from '../../core/types';

import { writeBuild } from './finalize';
import { openArchives } from './io';
import { mergeCell } from './merge';
import { maxObjectId, resolveCells } from './resolve';

export { stripOldLods } from './strip';

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
      // Merge the whole cell, then decimate it as one connected mesh (welded inside `decimateMesh`) to a fraction
      // of its triangles. One shared budget across surfaces — and welded topology — keeps coverage far higher than
      // decimating each model on its own did (which eroded every seam-split fragment → holes). Normals re-derived
      // after.
      const merged = mergeCell(cell, config.cellSize, source);
      const faceCount = merged.groups.reduce((sum, group) => sum + group.indices.length / 3, 0);
      // At least `min` triangles so sparse cells aren't over-thinned into holes; no upper cap — OpenSA has no
      // per-model streaming/material limits (this tool targets OpenSA, not the original game's streamer).
      const target = Math.max(Math.ceil(faceCount * config.lodCellRatio), config.lodCellMinTris);
      const decimated = decimateMesh(merged, target);
      const mesh = rebuildMeshNormals(decimated);

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
