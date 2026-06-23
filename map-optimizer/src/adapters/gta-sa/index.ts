import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GameAdapter } from '../../core/adapter';
import type { Asset, AssetRef, WriteResult } from '../../core/asset';

import { openArchive } from '../../../../src/renderware/archive/img-archive';
import { parseDff } from '../../../../src/renderware/parsers/binary/dff';
import { writeFullBuild } from './build';
import { encodeDff } from './codec/dff';
import { clumpToIr } from './read';
import { resolveMap } from './resolve';
import { optimizeTxd } from './textures';

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
export function createGtaSaAdapter(game: string, gameDir: string): GameAdapter & GtaSaTextureOps {
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

  return {
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
