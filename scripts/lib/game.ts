import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { IdeObjectDef, IplInstance } from '@opensa/renderware/parsers/text/types';

import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl, iplBasename } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
/**
 * Shared helpers for the dev scripts: resolve a game variant under `game-src/<game>/` and read its
 * real stock archives + data. `--game` defaults to `original`. Paths are relative to the cwd (repo root),
 * so scripts work regardless of which subfolder they live in.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** The variant's object catalog (id → def) + every placed instance. */
export interface MapData {
  catalog: Map<number, IdeObjectDef>;
  instances: PlacedInstance[];
}

/** A placed instance plus which IPL it came from (for diagnostics). */
export interface PlacedInstance extends IplInstance {
  from: string;
}

/** The `--game <name>` argument, or `fallback` (default `original`). */
export function gameArg(fallback = 'original'): string {
  const index = process.argv.indexOf('--game');

  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/** Absolute path of `game-src/<game>` (or a sub-path within it). */
export function gameDir(game: string, ...parts: string[]): string {
  return join(ROOT, 'game-src', game, ...parts);
}

/**
 * Resolve the variant's map offline (the sync, fs-based sibling of `resolveMap`): catalog from the
 * gta.dat IDEs + instances from the text IPLs (under `data/`) and the binary IPL streams **inside the
 * archive** (`gta3.img` — no more `ipl_binary/` files).
 */
export function loadMapDefs(game: string, archive: ImgArchive): MapData {
  const dat = readGtaDat(game);
  const base = gameDir(game);

  return {
    catalog: loadCatalog(base, dat.ide),
    instances: [...loadTextInstances(base, dat.ipl), ...loadBinaryInstances(archive)],
  };
}

/**
 * The variant's model archive: stock `gta3.img` (primary) with `gta_int.img` overlaid as a fallback
 * (interiors / the few props gta3 lacks) — the same merge `build-game` uses, so scripts see every model.
 */
export function openGameArchive(game: string): ImgArchive {
  const gta3 = openArchive(readBytes(gameDir(game, 'models', 'gta3.img')));
  const intPath = gameDir(game, 'models', 'gta_int.img');
  if (!statSync(intPath, { throwIfNoEntry: false })) {
    return gta3;
  }
  const gtaInt = openArchive(readBytes(intPath));

  return {
    get: (name: string): ArrayBuffer | null => gta3.get(name) ?? gtaInt.get(name),
    names: [...new Set([...gta3.names, ...gtaInt.names])],
  };
}

/** The positional CLI args (everything after the script), with the `--game <name>` pair removed. */
export function positionalArgs(): string[] {
  const args = process.argv.slice(2);
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--game') {
      i += 1; // skip its value too
      continue;
    }
    out.push(args[i]);
  }

  return out;
}

/** Read a file into a fresh, zero-offset Uint8Array (safe for DataView-based parsers). */
export function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Parse the variant's `gta.dat`. */
export function readGtaDat(game: string): ReturnType<typeof parseGtaDat> {
  return parseGtaDat(readFileSync(gameDir(game, 'data', 'gta.dat'), 'utf8'));
}

/** Instances from the binary IPL streams inside the archive (`gta3.img`). */
function loadBinaryInstances(archive: ImgArchive): PlacedInstance[] {
  const instances: PlacedInstance[] = [];
  for (const name of archive.names) {
    const buffer = name.endsWith('.ipl') ? archive.get(name) : null;
    if (!buffer) {
      continue;
    }
    for (const instance of parseBinaryIpl(buffer)) {
      instances.push({ ...instance, from: name });
    }
  }

  return instances;
}

/** Catalog (id → def) from every IDE the gta.dat lists (objs/tobj merged). */
function loadCatalog(base: string, idePaths: readonly string[]): Map<number, IdeObjectDef> {
  const catalog = new Map<number, IdeObjectDef>();
  for (const idePath of idePaths) {
    const file = datChildUrl(base, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      catalog.set(def.id, def);
    }
  }

  return catalog;
}

/** Instances from the text IPLs the gta.dat lists (`.zon` skipped). */
function loadTextInstances(base: string, iplPaths: readonly string[]): PlacedInstance[] {
  const instances: PlacedInstance[] = [];
  for (const iplPath of iplPaths) {
    const file = datChildUrl(base, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || !existsSync(file)) {
      continue;
    }
    for (const instance of parseIpl(readFileSync(file, 'utf8'))) {
      instances.push({ ...instance, from: iplBasename(iplPath) });
    }
  }

  return instances;
}
