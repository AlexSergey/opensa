import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GameAdapter } from '../../core/adapter';
import type { Asset, AssetRef, WriteResult } from '../../core/asset';

import { buildVer2Buffer, openArchive } from '../../../../src/renderware/archive/img-archive';
import { parseDff } from '../../../../src/renderware/parsers/binary/dff';
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
  /** Rebuilt TXD bytes (present unless it failed to parse). */
  bytes?: Uint8Array;
  /** True when the TXD couldn't be read/optimized (isolated — not packed into the `.img`). */
  failed: boolean;
  /** How many textures gained a mip chain. */
  mipped: number;
}

/**
 * GTA-SA (RenderWare) adapter. Encapsulates all of this game's I/O behind {@link GameAdapter}: resolving the
 * map's models, reading DFFs into the neutral IR (read-only reuse of `../src` parsers), and writing them back
 * via the in-house DFF serializer ({@link encodeDff}). On `finalize` it also packs every optimized model into
 * a stock VER2 `<game>.img` — the same archive format the input ships in — so the output is drop-in usable.
 * The serializer patches vertex attributes in place (positions/normals/prelit/UVs); topology edits and
 * anti-rip recovered geometry are not yet expressible and surface as per-asset failures.
 */
export function createGtaSaAdapter(game: string, gameDir: string): GameAdapter & GtaSaTextureOps {
  const modelsDir = join(gameDir, 'models');
  const dataDir = join(gameDir, 'data');
  const gta3 = openArchive(readArchive(join(modelsDir, 'gta3.img')));
  // Every other models/*.img (gta_int + any mod archives) is a fallback source for a model's bytes.
  const overrides = readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img') && file.toLowerCase() !== 'gta3.img')
    .sort()
    .map((file) => openArchive(readArchive(join(modelsDir, file))));
  const archives = [gta3, ...overrides];

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
      if (packed.length === 0) {
        return;
      }
      const entries = [...packed].sort((a, b) => a.name.localeCompare(b.name)); // deterministic order
      writeFileSync(join(outDir, `${game}.img`), buildVer2Buffer(entries));
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

        return { bytes: result.bytes, failed: false, mipped: result.processed };
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
