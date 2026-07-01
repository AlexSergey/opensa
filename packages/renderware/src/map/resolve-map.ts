import type { AssetFileSystem } from '../archive';
import type { IdeObjectDef, IplCarGenerator, IplInstance, MapDefinitions } from '../parsers/text';

import { iplBasename, normalizeDatPath } from '../archive';
import {
  parseBinaryCarGenerators,
  parseBinaryIpl,
  parseGtaDat,
  parseIde,
  parseIpl,
  parseTimedObjects,
  parseTxdParents,
} from '../parsers/text';

/** Path of `gta.dat` within the asset file system (loose, packed by relative path). */
const GTA_DAT = 'data/gta.dat';

export interface ResolveMapOptions {
  /**
   * Extra standalone binary IPL groups (basenames, no extension). These are the script-gated placement
   * groups vanilla toggles via LOAD_IPL/REMOVE_IPL (plan 042): `truthsfarm` (Truth's weed farm),
   * `barriers1`/`barriers2` (the SF/LV unlock roadblocks), `carter`/`crack` (mission-state crack-palace
   * pieces). They're not in gta.dat and carry no `_stream` suffix. Missing files are skipped.
   */
  extraIpl?: readonly string[];
}

/**
 * Resolve a whole map (framework-agnostic) from the asset file system: parse gta.dat, merge all IDE
 * object definitions into a catalog, and concatenate all IPL instances (text + the binary `_stream`
 * IPLs + configured standalone groups). Missing IDE/IPL files are skipped rather than aborting the map.
 */
export function resolveMap(fs: AssetFileSystem, options: ResolveMapOptions = {}): MapDefinitions {
  const datText = fs.getText(GTA_DAT);
  if (datText === null) {
    throw new Error(`${GTA_DAT} not found in the asset file system`);
  }
  const dat = parseGtaDat(datText);

  const catalog: MapDefinitions['catalog'] = new Map();
  const timedCatalog = new Map<number, IdeObjectDef>();
  const txdParents = new Map<string, string>();
  for (const idePath of dat.ide) {
    const text = fs.getText(normalizeDatPath(idePath));
    if (text === null) {
      continue;
    }
    for (const def of parseIde(text)) {
      catalog.set(def.id, def);
    }
    for (const def of parseTimedObjects(text)) {
      timedCatalog.set(def.id, def);
    }
    for (const [child, parent] of parseTxdParents(text)) {
      txdParents.set(child, parent); // later IDEs win, like the catalog
    }
  }

  const instances: IplInstance[] = [];
  const carGenerators: IplCarGenerator[] = [];
  for (const iplPath of dat.ipl) {
    if (iplPath.toLowerCase().endsWith('.zon')) {
      continue; // .ZON = zone definitions, not object placement (no inst, no streams)
    }
    const text = fs.getText(normalizeDatPath(iplPath));
    const textInstances = text !== null ? parseIpl(text) : [];
    // Full-detail placement lives in the matching binary stream IPLs (bare `<base>_streamN.ipl`).
    const streamInstances: IplInstance[] = [];
    loadBinaryStreams(fs, iplBasename(iplPath), streamInstances, carGenerators);
    // Flag LOD-target instances before flattening — the `lod` index is per-area (text file + its companion
    // binary streams share one index space; see the `ipl-lod-index-coupling` memory).
    markLodTargets(textInstances, streamInstances);
    instances.push(...textInstances, ...streamInstances);
  }

  // Standalone script-gated groups (plan 042) — the configured "world state" extras (bare `<name>.ipl`).
  for (const name of options.extraIpl ?? []) {
    const buffer = fs.get(`${name.toLowerCase()}.ipl`);
    if (buffer !== null) {
      instances.push(...parseBinaryIpl(buffer));
      carGenerators.push(...parseBinaryCarGenerators(buffer));
    }
  }

  return { carGenerators, catalog, imgDirs: dat.img.map(normalizeDatPath), instances, timedCatalog, txdParents };
}

/** Load the contiguous `<base>_stream{0,1,…}.ipl` binary streams that exist, collecting INST + CARS records. */
function loadBinaryStreams(
  fs: AssetFileSystem,
  basename: string,
  instances: IplInstance[],
  carGenerators: IplCarGenerator[],
): void {
  let index = 0;
  let buffer = fs.get(`${basename}_stream${index}.ipl`);
  while (buffer !== null) {
    instances.push(...parseBinaryIpl(buffer));
    carGenerators.push(...parseBinaryCarGenerators(buffer));
    index += 1;
    buffer = fs.get(`${basename}_stream${index}.ipl`);
  }
}

/**
 * Mark every LOD-target instance (`isLod`) within one area. Both a text IPL's own `lod` field and its companion
 * binary streams' `lod` fields index the **text** instance list (targets never live in a binary stream), so both
 * mark into `textInstances`. This is the authoritative LOD classification (vs the `lod`-name heuristic).
 */
function markLodTargets(textInstances: IplInstance[], streamInstances: IplInstance[]): void {
  const mark = (lod: number): void => {
    if (lod >= 0 && lod < textInstances.length) {
      textInstances[lod].isLod = true;
    }
  };
  for (const instance of textInstances) {
    mark(instance.lod);
  }
  for (const instance of streamInstances) {
    mark(instance.lod);
  }
}
