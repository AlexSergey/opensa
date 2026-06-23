import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GameAdapter } from '../../core/adapter';
import type { Asset, AssetRef, WriteResult } from '../../core/asset';

import { openArchive } from '../../../src/renderware/archive/img-archive';
import { parseDff } from '../../../src/renderware/parsers/binary/dff';
import { encodeDff } from './codec/dff';
import { clumpToIr } from './read';
import { resolveMapModels } from './resolve';

/**
 * GTA-SA (RenderWare) adapter. Encapsulates all of this game's I/O behind {@link GameAdapter}: resolving the
 * map's models, reading DFFs into the neutral IR (read-only reuse of `../src` parsers), and writing them back
 * via the in-house DFF serializer ({@link encodeDff}) — the write code lives here in `map-optimizer`, never in
 * `../src`. The serializer patches vertex attributes in place (positions/normals/prelit/UVs); topology edits
 * and anti-rip recovered geometry are not yet expressible and surface as per-asset failures.
 */
export function createGtaSaAdapter(game: string, gameDir: string): GameAdapter {
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

  return {
    game,
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
      return resolveMapModels(dataDir, gta3).map((name) => ({ name }));
    },
    write(asset: Asset): WriteResult {
      return { bytes: encodeDff(asset.source, asset.ir), fileName: `${asset.name}.dff` };
    },
  };
}

function readArchive(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}
