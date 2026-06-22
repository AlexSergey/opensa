/**
 * Game build (plan 048). Packs `game-src/<game>/` into content-hashed fflate chunks under
 * `static/games/<version>/` (one `manifest.json` lists them; `static/games` is gitignored, `static/viewer`
 * is committed):
 *  - data     — the contents of the loose `data/` folder (ide/ipl/dat/cfg/zon); NO dff/txd/col.
 *  - models   — the `.dff` geometry the EXTERIOR map references (interiors excluded) + every `.col`.
 *  - textures — the `.txd` textures the EXTERIOR map references.
 *  - others   — everything else: `.ipl`/`.ifp`/`.dat` from gta3.img + loose anim/text (ifp/gxt).
 * Each group is split into ~50MB chunks (see `game-build/chunk.ts`) so a dropped download re-fetches
 * one chunk, not the whole group. Model bytes come from gta3.img, falling back to gta_int.img for the
 * few props it lacks (override pattern). Usage: `tsx scripts/build-game.ts --game original`.
 */
import { type Zippable, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { loadEnv } from 'vite';

import type { GroupName } from '../src/loaders/types';
import type { ImgArchive } from '../src/renderware/archive/img-archive';

import { parseModelList } from '../src/game-build/env-list';
import {
  type Entry,
  ideRefs,
  looseGroup,
  type ModelRef,
  partitionEntries,
  placedModels,
} from '../src/game-build/partition';
import { openArchive } from '../src/renderware/archive/img-archive';
import { parseBinaryIpl } from '../src/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '../src/renderware/parsers/text/ipl.parser';
import { parsePedDefs } from '../src/renderware/parsers/text/ped-defs.parser';
import { parseVehicleDefs } from '../src/renderware/parsers/text/vehicle-defs.parser';
import { chunkByHash } from './game-build/chunk';

const ROOT = process.cwd();

/** Fixed zip timestamp (must be in the DOS 1980-2099 range) — keeps chunk bytes, hence the content
 *  hash / filename, stable across builds so the browser cache survives a version bump. */
const ZIP_MTIME = new Date('1985-01-01T00:00:00Z');

/**
 * Per-group caching policy, written onto every chunk in the manifest (`cached`). `true` ⇒ the client
 * persists it in Cache Storage; `false` ⇒ it is re-fetched on every load (never cached). `data` is kept
 * `false` so it doubles as a liveness probe: deleting the data zip on the server (a build revoke) makes
 * clients 404 on it and wipe their whole cache. See `asset-fetch-loader.ts`.
 */
const CACHED: Record<GroupName, boolean> = { data: false, models: true, others: true, textures: true };

/** One written chunk, recorded in the manifest. */
interface ChunkInfo {
  bytes: number;
  cached: boolean;
  entries: number;
  file: string;
  hash: string;
}

/** A file's bytes loaded for packing: its zip key + payload + size (for chunking). */
interface LoadedEntry {
  bytes: Uint8Array;
  name: string;
  size: number;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Build a zip's bytes — `.txd` stored (DXT is already compressed), everything else deflated. */
function buildZip(entries: readonly LoadedEntry[]): Uint8Array {
  const data: Zippable = {};
  for (const entry of entries) {
    data[entry.name] = [entry.bytes, { level: entry.name.endsWith('.txd') ? 0 : 6, mtime: ZIP_MTIME }];
  }

  return zipSync(data);
}

/**
 * TEMP: model + txd base names for the env-named main character (`peds.ide`) and vehicles (`vehicles.ide`).
 * Those are spawned dynamically (not placed on the map), so the partition misses them — pack them explicitly.
 */
function dynamicRefs(
  dataDir: string,
  mainCharacter?: string,
  vehiclesEnv?: string,
): { models: string[]; txds: string[] } {
  const models: string[] = [];
  const txds: string[] = [];

  const char = mainCharacter?.trim().toLowerCase();
  if (char) {
    const def = parsePedDefs(readIde(dataDir, 'peds.ide')).get(char);
    if (def) {
      models.push(def.model.toLowerCase());
      txds.push(def.txd.toLowerCase());
    }
  }

  const vehicles = parseModelList(vehiclesEnv);
  if (vehicles.length > 0) {
    const defs = parseVehicleDefs(readIde(dataDir, 'vehicles.ide'));
    for (const name of vehicles) {
      const def = defs.get(name);
      if (def) {
        models.push(def.model.toLowerCase());
        txds.push(def.txd.toLowerCase());
      }
    }
  }

  return { models, txds };
}

/** id → {model, txd} (lowercased) from every IDE under the variant's data folder. */
function ideIdMap(dataDir: string): Map<number, ModelRef> {
  const map = new Map<number, ModelRef>();
  for (const file of walk(dataDir).filter((p) => p.toLowerCase().endsWith('.ide'))) {
    for (const [id, ref] of ideRefs(readFileSync(file, 'utf8'))) {
      map.set(id, ref);
    }
  }

  return map;
}

function main(): void {
  const game = argValue('--game');
  if (!game) {
    throw new Error('usage: tsx scripts/build-game.ts --game <name>');
  }
  const src = join(ROOT, 'game-src', game);
  if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game-src/${game} not found`);
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
  const version = `${game}-${pkg.version}`;
  const outDir = join(ROOT, 'static', 'games', version);
  mkdirSync(outDir, { recursive: true });
  // Drop prior chunks/manifest — content-hashed names mean stale chunks would otherwise pile up.
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.zip') || file === 'manifest.json') {
      rmSync(join(outDir, file));
    }
  }

  // Model archives: `gta3.img` is primary; EVERY other `models/*.img` (gta_int + any mod archives the game
  // ships, e.g. gostown's `gostown6.img`) is merged as the override/fallback. names are already lowercased.
  const modelsDir = join(src, 'models');
  const gta3 = openArchive(readFileSync(join(modelsDir, 'gta3.img')));
  const overrides = readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img') && file.toLowerCase() !== 'gta3.img')
    .sort()
    .map((file) => openArchive(readFileSync(join(modelsDir, file))));
  const gtaInt: ImgArchive = mergeArchives(overrides);
  const gta3Names = new Set(gta3.names);
  const gtaIntNames = new Set(gtaInt.names);

  const dataDir = join(src, 'data');
  const placed = placedModels(placedInstanceIds(dataDir, gta3), ideIdMap(dataDir));
  // TEMP (bring-your-own-files): also pack the env-named main character (peds.ide) + vehicles (vehicles.ide),
  // since peds/cars are spawned dynamically, not placed on the map. Reads the local `.env` like the app does.
  const env = loadEnv('production', ROOT, 'VITE_');
  const dynamic = dynamicRefs(dataDir, env.VITE_MAIN_CHARACTER, env.VITE_VEHICLES);
  const refs = { models: [...placed.models, ...dynamic.models], txds: [...placed.txds, ...dynamic.txds] };
  const { models: modelEntries, others, textures: textureEntries } = partitionEntries(refs, gta3Names, gtaIntNames);
  // `partitionEntries` only pulls world files from gta3.img; pull a mod's from the override archives too
  // (e.g. gostown's `.col` in gostown6.img). `.col` joins models, the rest (ipl/ifp/dat) joins others.
  const overrideName = (extensions: readonly string[]): Entry[] =>
    [...gtaIntNames]
      .filter((name) => !gta3Names.has(name) && extensions.some((ext) => name.endsWith(ext)))
      .map((name) => ({ name, source: 'gta_int' }));
  const overrideCol = overrideName(['.col']);
  const overrideOthers = overrideName(['.ipl', '.ifp', '.dat']);

  // Load a partition entry's bytes from the right archive.
  const loadImg = (entry: Entry): LoadedEntry => {
    const bytes = new Uint8Array((entry.source === 'gta3' ? gta3 : gtaInt).get(entry.name)!);

    return { bytes, name: entry.name, size: bytes.length };
  };

  // Loose files (everything except the model archives + the stock anim.img — ped.ifp is used directly),
  // keyed by their lowercased relative path and bucketed by `looseGroup` (data folder → data, dff → models,
  // txd → textures, the rest → others). ALL `models/*.img` are read above, so skip them here. Files under
  // loose `player/` and `vehicles/` also get a **bare-name** alias that OVERRIDES the same-named entry from
  // the img archives (so a modder's loose `vehicles/admiral.dff` wins over gta3.img's).
  const excluded = new Set([join('anim', 'anim.img')]);
  const isModelImg = new RegExp(`^models\\${sep}.+\\.img$`, 'i');
  const overrideBare = new Set<string>(); // bare names provided by loose player/ + vehicles/
  const loose: Record<GroupName, LoadedEntry[]> = { data: [], models: [], others: [], textures: [] };
  for (const path of walk(src)) {
    const rel = relative(src, path);
    if (excluded.has(rel) || isModelImg.test(rel) || path.endsWith('.DS_Store')) {
      continue;
    }
    const bytes = new Uint8Array(readFileSync(path));
    const name = rel.split(sep).join('/').toLowerCase();
    loose[looseGroup(name)].push({ bytes, name, size: bytes.length });
    if (name.startsWith('player/') || name.startsWith('vehicles/')) {
      const bare = name.slice(name.lastIndexOf('/') + 1);
      if (!overrideBare.has(bare)) {
        overrideBare.add(bare);
        loose[looseGroup(bare)].push({ bytes, name: bare, size: bytes.length }); // bare alias → overrides img
      }
    }
  }
  // Drop img model/texture entries the loose player/vehicles files override (their bytes are packed above).
  const models = modelEntries.filter((entry) => !overrideBare.has(entry.name));
  const textures = textureEntries.filter((entry) => !overrideBare.has(entry.name));

  // Pack each group into ~50MB content-hashed chunks (sequential so peak memory ≈ the largest group).
  const dataChunks = packChunks('data', loose.data, outDir);
  const othersChunks = packChunks(
    'others',
    [...loose.others, ...others.map(loadImg), ...overrideOthers.map(loadImg)],
    outDir,
  );
  const modelChunks = packChunks(
    'models',
    [...loose.models, ...models.map(loadImg), ...overrideCol.map(loadImg)],
    outDir,
  );
  const textureChunks = packChunks('textures', [...loose.textures, ...textures.map(loadImg)], outDir);

  const manifest = {
    chunks: { data: dataChunks, models: modelChunks, others: othersChunks, textures: textureChunks },
    game,
    version,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const fromInt = [...others, ...overrideOthers, ...models, ...overrideCol, ...textures].filter(
    (e) => e.source === 'gta_int',
  ).length;
  const mb = (chunks: ChunkInfo[]): string =>
    `${(chunks.reduce((sum, c) => sum + c.bytes, 0) / 1024 / 1024).toFixed(1)} MB`;
  const othersCount = loose.others.length + others.length + overrideOthers.length;
  const modelsCount = loose.models.length + models.length + overrideCol.length;
  console.log(`build ${version}:`);
  console.log(`  data     — ${dataChunks.length} chunk(s), ${loose.data.length} files, ${mb(dataChunks)}`);
  console.log(`  others   — ${othersChunks.length} chunk(s), ${othersCount} files, ${mb(othersChunks)}`);
  console.log(`  models   — ${modelChunks.length} chunk(s), ${modelsCount} dff/col, ${mb(modelChunks)}`);
  console.log(
    `  textures — ${textureChunks.length} chunk(s), ${loose.textures.length + textures.length} txd, ${mb(textureChunks)}`,
  );
  console.log(`  from override img(s) (gta_int/mods): ${fromInt} files`);
  console.log(`  → static/games/${version}/`);
}

/** Merge archives into one, earlier wins on name collisions — reads mod model archives alongside gta3.img. */
function mergeArchives(archives: readonly ImgArchive[]): ImgArchive {
  return {
    get: (name: string): ArrayBuffer | null => {
      for (const archive of archives) {
        const bytes = archive.get(name);
        if (bytes) {
          return bytes;
        }
      }

      return null;
    },
    names: [...new Set(archives.flatMap((archive) => archive.names))],
  };
}

/** Split a group into ~50MB content-hashed zips, write them, and return one {@link ChunkInfo} per chunk. */
function packChunks(group: GroupName, entries: readonly LoadedEntry[], outDir: string): ChunkInfo[] {
  const cached = CACHED[group];

  return chunkByHash(entries).map((bucket) => {
    const sorted = [...bucket].sort((a, b) => a.name.localeCompare(b.name)); // stable order → stable bytes
    const zip = buildZip(sorted);
    const hash = createHash('sha1').update(zip).digest('hex').slice(0, 12);
    const file = `${group}-${hash}.zip`;
    writeFileSync(join(outDir, file), zip);

    return { bytes: zip.length, cached, entries: bucket.length, file, hash };
  });
}

/** Instance ids placed in the EXTERIOR map: text IPLs (excluding interior/) + the binary IPL streams. */
function placedInstanceIds(dataDir: string, gta3: ImgArchive): number[] {
  const ids: number[] = [];
  for (const file of walk(dataDir)) {
    if (!file.toLowerCase().endsWith('.ipl') || /[\\/]interior[\\/]/i.test(file)) {
      continue;
    }
    for (const inst of parseIpl(readFileSync(file, 'utf8'))) {
      ids.push(inst.id);
    }
  }
  for (const name of gta3.names) {
    if (name.endsWith('.ipl')) {
      const buffer = gta3.get(name);
      if (buffer) {
        for (const inst of parseBinaryIpl(buffer)) {
          ids.push(inst.id);
        }
      }
    }
  }

  return ids;
}

/** Read an IDE file from the data folder, or '' when absent (so the parsers just yield nothing). */
function readIde(dataDir: string, name: string): string {
  const path = join(dataDir, name);

  return statSync(path, { throwIfNoEntry: false }) ? readFileSync(path, 'utf8') : '';
}

/** Recursively list every file under `dir`. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
    } else {
      out.push(path);
    }
  }

  return out;
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
