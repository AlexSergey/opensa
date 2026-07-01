import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { createTextureSource } from '@opensa/sa-lod/texture-source';
import { join } from 'node:path';

import type { SaLodAdapter } from '../../core/adapter';
import type { SizingReport } from '../../core/report';
import type { LodConfig, ResolveResult } from '../../core/types';
import type { BuildStats } from './finalize';

import { summarize } from '../../core/report';
import { writeBuild } from './finalize';
import { openArchives } from './io';
import { resolveLodLinks } from './resolve';

/**
 * GTA-SA (RenderWare) adapter for sa-lod-generator. Phase 1 (`docs/plans/002`): resolve the map's HD↔LOD links
 * from the IPL `lod` field (sizing report), then `finalize` clones every per-object LOD from its HD model with a
 * 50 % TXD into a drop-in build. Read-only reuse of the engine parsers; archives are opened once and shared.
 */
export function createSaLodAdapter(game: string, gameDir: string, config: LodConfig): SaLodAdapter {
  const archives = openArchives(join(gameDir, 'models'));
  const dataDir = join(gameDir, 'data');
  const source = createTextureSource(archives.all);
  const halvings = halvingsFor(config.texScale);
  const holeModels = new Set(config.holeFillModels ?? []);
  const holeLodDraw = config.holeLodDraw ?? 1500;

  // Triangle count per model (DFF), cached — drives the sizing report.
  const triCache = new Map<string, number>();
  const tris = (model: string): number => {
    const cached = triCache.get(model);
    if (cached !== undefined) {
      return cached;
    }
    let total = 0;
    const bytes = archives.get(`${model}.dff`);
    if (bytes) {
      try {
        for (const geometry of parseDff(bytes).geometries) {
          total += geometry.triangles.length;
        }
      } catch {
        total = 0; // unparseable model — counts as 0, not a crash
      }
    }
    triCache.set(model, total);

    return total;
  };

  return {
    finalize: (outDir: string, resolved: ResolveResult): BuildStats =>
      writeBuild({ archives, gameDir, halvings, holeLodDraw, holeModels, links: resolved.links, outDir, source }),
    game,
    report: (resolved: ResolveResult): SizingReport => summarize(resolved, tris),
    resolvePairs: (): ResolveResult => resolveLodLinks(dataDir, archives.gta3),
  };
}

/** Power-of-two downscale steps for a texture scale (0.5 → 1 halving, 0.25 → 2); clamped at 0. */
function halvingsFor(texScale: number): number {
  return Math.max(0, Math.round(Math.log2(1 / texScale)));
}
