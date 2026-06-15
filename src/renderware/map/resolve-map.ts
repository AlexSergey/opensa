import type { AssetFileSystem } from '../archive';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';

import { iplBasename, normalizeDatPath } from '../archive';
import { parseBinaryIpl, parseGtaDat, parseIde, parseIpl, parseTimedObjects, parseTxdParents } from '../parsers/text';

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
  for (const iplPath of dat.ipl) {
    if (iplPath.toLowerCase().endsWith('.zon')) {
      continue; // .ZON = zone definitions, not object placement (no inst, no streams)
    }
    const text = fs.getText(normalizeDatPath(iplPath));
    if (text !== null) {
      instances.push(...parseIpl(text));
    }
    // Full-detail placement lives in the matching binary stream IPLs (bare `<base>_streamN.ipl`).
    instances.push(...loadBinaryStreams(fs, iplBasename(iplPath)));
  }

  // Standalone script-gated groups (plan 042) — the configured "world state" extras (bare `<name>.ipl`).
  for (const name of options.extraIpl ?? []) {
    const buffer = fs.get(`${name.toLowerCase()}.ipl`);
    if (buffer !== null) {
      instances.push(...parseBinaryIpl(buffer));
    }
  }

  return { catalog, imgDirs: dat.img.map(normalizeDatPath), instances, timedCatalog, txdParents };
}

/** Load the contiguous `<base>_stream{0,1,…}.ipl` binary streams that exist in the file system. */
function loadBinaryStreams(fs: AssetFileSystem, basename: string): IplInstance[] {
  const instances: IplInstance[] = [];
  let index = 0;
  let buffer = fs.get(`${basename}_stream${index}.ipl`);
  while (buffer !== null) {
    instances.push(...parseBinaryIpl(buffer));
    index += 1;
    buffer = fs.get(`${basename}_stream${index}.ipl`);
  }

  return instances;
}
