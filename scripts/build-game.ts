/**
 * Game build (plan 048). Packs `game-src/<game>/` into three fflate zips under `static/<version>/`:
 *  - priority.zip — loose data/player/vehicles/anim/etc. + world files (col/ipl/ifp/dat); NO dff/txd.
 *  - models.zip   — the `.dff` geometry the EXTERIOR map references (interiors excluded).
 *  - textures.zip — the `.txd` textures the EXTERIOR map references.
 * Model bytes come from gta3.img, falling back to gta_int.img for the few props it lacks (override pattern).
 * Usage: `tsx scripts/build-game.ts --game original`.
 */
import { type Zippable, zipSync } from 'fflate';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import type { ImgArchive } from '../src/renderware/archive/img-archive';

import { openArchive } from '../src/renderware/archive/img-archive';
import { parseIde } from '../src/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '../src/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '../src/renderware/parsers/text/ipl.parser';
import { type Entry, type ModelRef, partitionEntries, placedModels } from './game-build/partition';

const ROOT = process.cwd();

/** One file to write into a zip: its key + a lazy byte reader (so we never hold all files in memory at once). */
interface ZipEntry {
  name: string;
  read: () => Uint8Array;
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** id → {model, txd} (lowercased) from every IDE under the variant's data folder. */
function ideIdMap(dataDir: string): Map<number, ModelRef> {
  const map = new Map<number, ModelRef>();
  for (const file of walk(dataDir).filter((p) => p.toLowerCase().endsWith('.ide'))) {
    for (const def of parseIde(readFileSync(file, 'utf8'))) {
      map.set(def.id, { model: def.modelName.toLowerCase(), txd: def.txdName.toLowerCase() });
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

  // Map a partition entry to its lazy byte reader from the right archive.
  const imgEntry = (entry: Entry): ZipEntry => {
    const archive = entry.source === 'gta3' ? gta3 : gtaInt;

    return { name: entry.name, read: () => new Uint8Array(archive.get(entry.name)!) };
  };

  // Loose files (everything except the model archives + the stock anim.img — ped.ifp is used directly),
  // keyed by their lowercased relative path.
  const excluded = new Set([join('anim', 'anim.img'), join('models', 'gta3.img'), join('models', 'gta_int.img')]);
  const loose: ZipEntry[] = [];
  for (const path of walk(src)) {
    const rel = relative(src, path);
    if (excluded.has(rel) || path.endsWith('.DS_Store')) {
      continue;
    }
    loose.push({ name: rel.split(sep).join('/').toLowerCase(), read: () => new Uint8Array(readFileSync(path)) });
  }

  const priorityPath = join(outDir, 'priority.zip');
  const modelsPath = join(outDir, 'models.zip');
  const texturesPath = join(outDir, 'textures.zip');
  writeZip(priorityPath, [...loose, ...priority.map(imgEntry)]);
  writeZip(modelsPath, models.map(imgEntry));
  writeZip(texturesPath, textures.map(imgEntry));

  const priorityBytes = statSync(priorityPath).size;
  const modelsBytes = statSync(modelsPath).size;
  const texturesBytes = statSync(texturesPath).size;
  const manifest = {
    game,
    models: { bytes: modelsBytes, entries: models.length, file: 'models.zip' },
    priority: { bytes: priorityBytes, entries: loose.length + priority.length, file: 'priority.zip' },
    textures: { bytes: texturesBytes, entries: textures.length, file: 'textures.zip' },
    version,
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const fromInt = [...priority, ...models, ...textures].filter((e) => e.source === 'gta_int').length;
  const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(1)} MB`;
  console.log(`build ${version}:`);
  console.log(`  priority.zip — ${loose.length} loose + ${priority.length} world files, ${mb(priorityBytes)}`);
  console.log(`  models.zip   — ${models.length} dff, ${mb(modelsBytes)}`);
  console.log(`  textures.zip — ${textures.length} txd, ${mb(texturesBytes)}`);
  console.log(`  from gta_int.img (override): ${fromInt} files`);
  console.log(`  → static/${version}/`);
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

/** Build a zip and write it — `.txd` stored (DXT is already compressed), everything else deflated. */
function writeZip(outPath: string, entries: ZipEntry[]): void {
  const data: Zippable = {};
  for (const entry of entries) {
    data[entry.name] = [entry.read(), { level: entry.name.endsWith('.txd') ? 0 : 6 }];
  }
  writeFileSync(outPath, zipSync(data));
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
