import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { isLodModel } from '@opensa/renderware/parsers/text/lod';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GameAdapter } from '../../core/adapter';
import type { Asset, AssetRef, WriteResult } from '../../core/asset';

import { writeFullBuild } from './build';
import { encodeDff } from './codec/dff';
import { computeGapStitches, type GapModel, type GapStitchOptions, type GapStitchResult } from './gap-stitch';
import { clumpToIr } from './read';
import { type Placement, resolveMap, resolvePlacements } from './resolve';
import { computeSeamOverrides, type SeamModel, type SeamWeldOptions, type SeamWeldResult } from './seam-weld';
import { optimizeTxd } from './textures';

/** GTA-SA gap-stitch op, exposed for the optional cross-model geometry stitch (plan 017). */
export interface GtaSaGapOps {
  /** Compute per-model position overrides that close hairline cross-model cracks (uniquely-placed models only). */
  buildGapStitches(options?: GapStitchOptions): GapStitchResult;
}

/** GTA-SA seam-weld op, exposed for the optional cross-model prelit weld (plan 016). */
export interface GtaSaSeamOps {
  /** Compute per-model prelit overrides that close cross-model tile seams (uniquely-placed models only). */
  buildSeamOverrides(options?: SeamWeldOptions): SeamWeldResult;
}

/** GTA-SA texture-pass ops, exposed alongside the {@link GameAdapter} for the optional mip pass (plan 010). */
export interface GtaSaTextureOps {
  /** Read `<name>.txd`, generate mip chains, pack the result into the output `.img`; null if not in archives. */
  optimizeTexture(name: string): null | TextureOutcome;
  /** The TXD names the map references. */
  resolveTextures(): string[];
}

/** Outcome of optimizing one TXD. `null` (from `optimizeTexture`) means it wasn't in the archives. */
export interface TextureOutcome {
  /** True when the TXD couldn't be read/optimized (isolated — not packed into the build). */
  failed: boolean;
  /** How many textures gained a mip chain. */
  mipped: number;
}

/**
 * GTA-SA (RenderWare) adapter. Encapsulates all of this game's I/O behind {@link GameAdapter}: resolving the
 * map's models, reading DFFs into the neutral IR (read-only reuse of `../src` parsers), and writing them back
 * via the in-house DFF serializer ({@link encodeDff}). On `finalize` it emits a **full drop-in build**: the
 * whole game-src tree is mirrored to `out/`, with each `models/*.img` rebuilt so the optimized entries are
 * swapped in and everything else (vehicles, peds, interiors, …) is preserved (plan 011).
 * The serializer patches vertex attributes in place (positions/normals/prelit/UVs); topology edits and
 * anti-rip recovered geometry are not yet expressible and surface as per-asset failures.
 */
export function createGtaSaAdapter(
  game: string,
  gameDir: string,
): GameAdapter & GtaSaGapOps & GtaSaSeamOps & GtaSaTextureOps {
  const modelsDir = join(gameDir, 'models');
  const dataDir = join(gameDir, 'data');
  // Open every models/*.img once, keyed by filename (so `finalize` can rebuild each in place). gta3.img is the
  // primary source; the rest (gta_int + any mod archives) are byte fallbacks.
  const imgFiles = readdirSync(modelsDir).filter((file) => file.toLowerCase().endsWith('.img'));
  const gta3File = imgFiles.find((file) => file.toLowerCase() === 'gta3.img');
  if (!gta3File) {
    throw new Error('models/gta3.img not found');
  }
  const archivesByFile = new Map(imgFiles.map((file) => [file, openArchive(readArchive(join(modelsDir, file)))]));
  const gta3 = archivesByFile.get(gta3File)!;
  const others = imgFiles.filter((file) => file !== gta3File).sort();
  const archives = [gta3, ...others.map((file) => archivesByFile.get(file)!)];

  const getModel = (name: string): ArrayBuffer | null => {
    for (const archive of archives) {
      const bytes = archive.get(name);
      if (bytes) {
        return bytes;
      }
    }

    return null;
  };

  const placed = resolveMap(dataDir, gta3); // map's models + txds, resolved once

  // Optimized models + textures collected during the run, packed into a VER2 .img on finalize().
  const packed: { data: Uint8Array; name: string }[] = [];

  // Uniquely-placed models (placed exactly once), for the world-context passes. `lod*` are dropped by default
  // (the engine's LOD gate — reused by every LOD tool): a far-LOD isn't co-visible with its HD, so editing that
  // pair is pointless (plan 016). `_lodbit`/`_lod` tiles are NOT `lod*`-prefixed → kept as HD-tier.
  const uniquePlacements = (includeLods?: boolean): Map<string, Placement> => {
    const placements = resolvePlacements(dataDir, gta3);
    const counts = new Map<string, number>();
    for (const placement of placements) {
      counts.set(placement.modelName, (counts.get(placement.modelName) ?? 0) + 1);
    }
    const unique = new Map<string, Placement>();
    for (const placement of placements) {
      if (counts.get(placement.modelName) === 1 && (includeLods || !isLodModel(placement.modelName))) {
        unique.set(placement.modelName, placement);
      }
    }

    return unique;
  };

  return {
    buildGapStitches(options?: GapStitchOptions): GapStitchResult {
      const models: GapModel[] = [];
      for (const [name, placement] of uniquePlacements(options?.includeLods)) {
        const bytes = getModel(`${name}.dff`);
        if (!bytes) {
          continue;
        }
        try {
          const geometries = parseDff(bytes).geometries.map((geometry) => ({
            positions: geometry.positions,
            triangles: geometry.triangles.map((triangle) => ({ a: triangle.a, b: triangle.b, c: triangle.c })),
          }));
          models.push({ geometries, name, placement: { position: placement.position, rotation: placement.rotation } });
        } catch {
          continue; // unparseable model — skip it, the stitch is best-effort
        }
      }

      return computeGapStitches(models, options);
    },
    buildSeamOverrides(options?: SeamWeldOptions): SeamWeldResult {
      const models: SeamModel[] = [];
      for (const [name, placement] of uniquePlacements(options?.includeLods)) {
        const bytes = getModel(`${name}.dff`);
        if (!bytes) {
          continue;
        }
        try {
          const geometries = parseDff(bytes)
            .geometries.filter((geometry) => geometry.prelitColors)
            .map((geometry) => ({
              positions: geometry.positions,
              prelit: geometry.prelitColors!,
              triangles: geometry.triangles.map((triangle) => ({ a: triangle.a, b: triangle.b, c: triangle.c })),
            }));
          if (geometries.length > 0) {
            models.push({
              geometries,
              name,
              placement: { position: placement.position, rotation: placement.rotation },
            });
          }
        } catch {
          continue; // unparseable model — skip it, the weld pass is best-effort
        }
      }

      return computeSeamOverrides(models, options);
    },
    finalize(outDir: string): void {
      // Mirror the whole game into out/, rebuilding each model archive with the optimized entries swapped in
      // and everything else (vehicles, peds, …) preserved — a drop-in build (plan 011).
      const optimized = new Map(packed.map((entry) => [entry.name, entry.data]));
      writeFullBuild(gameDir, outDir, archivesByFile, optimized);
    },
    game,
    optimizeTexture(name: string): null | TextureOutcome {
      const bytes = getModel(`${name}.txd`);
      if (!bytes) {
        return null;
      }
      try {
        const result = optimizeTxd(new Uint8Array(bytes));
        packed.push({ data: result.bytes, name: `${name}.txd` });

        return { failed: false, mipped: result.processed };
      } catch {
        return { failed: true, mipped: 0 }; // unparseable TXD — isolate, leave it out of the .img
      }
    },
    read(ref: AssetRef): Asset {
      const bytes = getModel(`${ref.name}.dff`);
      if (!bytes) {
        throw new Error(`model not found in archives: ${ref.name}.dff`);
      }

      return {
        dirty: false,
        ir: clumpToIr(parseDff(bytes)),
        log: [],
        meta: {},
        name: ref.name,
        source: new Uint8Array(bytes),
      };
    },
    resolve(): AssetRef[] {
      return placed.models.map((name) => ({ name }));
    },
    resolveTextures(): string[] {
      return placed.txds;
    },
    write(asset: Asset): WriteResult {
      const bytes = encodeDff(asset.source, asset.ir);
      packed.push({ data: bytes, name: `${asset.name}.dff` });

      return { bytes, fileName: `${asset.name}.dff` };
    },
  };
}

function readArchive(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
