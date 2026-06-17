/**
 * Game build (plan 048). Packs `game-src/<game>/` into content-hashed fflate chunks under
 * `static/<version>/` (one `manifest.json` lists them):
 *  - priority — loose data/player/vehicles/anim/etc. + world files (col/ipl/ifp/dat); NO dff/txd.
 *  - models   — the `.dff` geometry the EXTERIOR map references (interiors excluded).
 *  - textures — the `.txd` textures the EXTERIOR map references.
 * Each group is split into ~50MB chunks (see `game-build/chunk.ts`) so a dropped download re-fetches
 * one chunk, not the whole group. Model bytes come from gta3.img, falling back to gta_int.img for the
 * few props it lacks (override pattern). Usage: `tsx scripts/build-game.ts --game original`.
 */
import { type Zippable, zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ImgArchive } from '../src/renderware/archive/img-archive';

import { openArchive } from '../src/renderware/archive/img-archive';
import { parseBinaryIpl } from '../src/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '../src/renderware/parsers/text/ipl.parser';
import { chunkByHash } from './game-build/chunk';
import { type Entry, ideRefs, type ModelRef, partitionEntries, placedModels } from './game-build/partition';

const ROOT = process.cwd();

/** Fixed zip timestamp (must be in the DOS 1980-2099 range) — keeps chunk bytes, hence the content
 *  hash / filename, stable across builds so the browser cache survives a version bump. */
const ZIP_MTIME = new Date('1985-01-01T00:00:00Z');

/** One written chunk, recorded in the manifest. */
interface ChunkInfo {
  bytes: number;
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
  const outDir = join(ROOT, 'static', version);
  mkdirSync(outDir, { recursive: true });
  // Drop prior chunks/manifest — content-hashed names mean stale chunks would otherwise pile up.
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.zip') || file === 'manifest.json') {
      rmSync(join(outDir, file));
    }
  }

  // Open both model archives (gta3.img primary, gta_int.img override). names are already lowercased.
  const gta3 = openArchive(readFileSync(join(src, 'models', 'gta3.img')));
  const gtaIntPath = join(src, 'models', 'gta_int.img');
  const gtaInt: ImgArchive = statSync(gtaIntPath, { throwIfNoEntry: false })
    ? openArchive(readFileSync(gtaIntPath))
    : { get: (): null => null, names: [] };
  const gta3Names = new Set(gta3.names);
  const gtaIntNames = new Set(gtaInt.names);

  const dataDir = join(src, 'data');
  const placed = placedModels(placedInstanceIds(dataDir, gta3), ideIdMap(dataDir));
  const { models, priority, textures } = partitionEntries(placed, gta3Names, gtaIntNames);

  // Load a partition entry's bytes from the right archive.
  const loadImg = (entry: Entry): LoadedEntry => {
    const bytes = new Uint8Array((entry.source === 'gta3' ? gta3 : gtaInt).get(entry.name)!);

    return { bytes, name: entry.name, size: bytes.length };
  };

  // Loose files (everything except the model archives + the stock anim.img — ped.ifp is used directly),
  // keyed by their lowercased relative path.
  const excluded = new Set([join('anim', 'anim.img'), join('models', 'gta3.img'), join('models', 'gta_int.img')]);
  const loose: LoadedEntry[] = [];
  for (const path of walk(src)) {
    const rel = relative(src, path);
    if (excluded.has(rel) || path.endsWith('.DS_Store')) {
      continue;
    }
    const bytes = new Uint8Array(readFileSync(path));
    loose.push({ bytes, name: rel.split(sep).join('/').toLowerCase(), size: bytes.length });
  }

  // Pack each group into ~50MB content-hashed chunks (sequential so peak memory ≈ the largest group).
  const priorityChunks = packChunks('priority', [...loose, ...priority.map(loadImg)], outDir);
  const modelChunks = packChunks('models', models.map(loadImg), outDir);
  const textureChunks = packChunks('textures', textures.map(loadImg), outDir);

  const manifest = {
    chunks: { models: modelChunks, priority: priorityChunks, textures: textureChunks },
    game,
    version,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const fromInt = [...priority, ...models, ...textures].filter((e) => e.source === 'gta_int').length;
  const mb = (chunks: ChunkInfo[]): string =>
    `${(chunks.reduce((sum, c) => sum + c.bytes, 0) / 1024 / 1024).toFixed(1)} MB`;
  console.log(`build ${version}:`);
  console.log(
    `  priority — ${priorityChunks.length} chunk(s), ${loose.length + priority.length} files, ${mb(priorityChunks)}`,
  );
  console.log(`  models   — ${modelChunks.length} chunk(s), ${models.length} dff, ${mb(modelChunks)}`);
  console.log(`  textures — ${textureChunks.length} chunk(s), ${textures.length} txd, ${mb(textureChunks)}`);
  console.log(`  from gta_int.img (override): ${fromInt} files`);
  console.log(`  → static/${version}/`);
}

/** Split a group into ~50MB content-hashed zips, write them, and return one {@link ChunkInfo} per chunk. */
function packChunks(prefix: string, entries: readonly LoadedEntry[], outDir: string): ChunkInfo[] {
  return chunkByHash(entries).map((bucket) => {
    const sorted = [...bucket].sort((a, b) => a.name.localeCompare(b.name)); // stable order → stable bytes
    const zip = buildZip(sorted);
    const hash = createHash('sha1').update(zip).digest('hex').slice(0, 12);
    const file = `${prefix}-${hash}.zip`;
    writeFileSync(join(outDir, file), zip);

    return { bytes: zip.length, entries: bucket.length, file, hash };
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
