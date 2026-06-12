import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';

import { datChildUrl, iplBasename, normalizeDatPath, standaloneIplUrl, streamIplUrl } from '../archive';
import { parseBinaryIpl, parseGtaDat, parseIde, parseIpl, parseTimedObjects, parseTxdParents } from '../parsers/text';

/** Stream-count manifest ({ basename: count }) so we load exactly the binary
 * stream IPLs that exist — no probe-by-404 (e.g. `map_stream0.ipl`). */
type StreamManifest = Record<string, number>;

export interface ResolveMapOptions {
  /**
   * Extra standalone binary IPLs to load from `ipl_binary/` (basenames, no extension). These are
   * the script-gated placement groups vanilla toggles via LOAD_IPL/REMOVE_IPL (plan 042):
   * `truthsfarm` (Truth's weed farm), `barriers1`/`barriers2` (the SF/LV unlock roadblocks),
   * `carter`/`crack` (mission-state crack-palace pieces). They're not in gta.dat and carry no
   * `_stream` suffix, so the manifest walk never finds them. Missing files are skipped.
   */
  extraIpl?: readonly string[];
}

/**
 * Resolve a whole map (framework-agnostic): parse gta.dat, merge all IDE object
 * definitions into a catalog, and concatenate all IPL instances (text + binary
 * streams + configured standalone groups). Missing IDE/IPL files are skipped
 * rather than aborting the map.
 */
export async function resolveMap(
  datUrl: string,
  base: string,
  options: ResolveMapOptions = {},
): Promise<MapDefinitions> {
  const dat = parseGtaDat(await fetchText(datUrl));

  const catalog: MapDefinitions['catalog'] = new Map();
  const timedCatalog = new Map<number, IdeObjectDef>();
  const txdParents = new Map<string, string>();
  for (const idePath of dat.ide) {
    const text = await fetchTextOrNull(datChildUrl(base, idePath));
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

  const manifest = await fetchStreamManifest(base);
  const instances: IplInstance[] = [];
  for (const iplPath of dat.ipl) {
    if (iplPath.toLowerCase().endsWith('.zon')) {
      continue; // .ZON = zone definitions, not object placement (no inst, no streams)
    }
    const text = await fetchTextOrNull(datChildUrl(base, iplPath));
    if (text !== null) {
      instances.push(...parseIpl(text));
    }
    // Full-detail placement lives in the matching binary stream IPLs.
    instances.push(...(await loadBinaryStreams(base, iplBasename(iplPath), manifest)));
  }

  // Standalone script-gated groups (plan 042) — the configured "world state" extras.
  for (const name of options.extraIpl ?? []) {
    const buffer = await fetchArrayBufferOrNull(standaloneIplUrl(base, name));
    if (buffer !== null) {
      instances.push(...parseBinaryIpl(buffer));
    }
  }

  return { catalog, imgDirs: dat.img.map(normalizeDatPath), instances, timedCatalog, txdParents };
}

async function fetchArrayBufferOrNull(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);

    return response.ok ? await response.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function fetchStreamManifest(base: string): Promise<StreamManifest> {
  try {
    const response = await fetch(`${base.replace(/\/+$/, '')}/ipl_binary/manifest.json`);
    if (!response.ok) {
      return {};
    }

    return (await response.json()) as StreamManifest;
  } catch {
    return {};
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

/** Like fetchText but tolerant: returns null for a missing file or network error. */
async function fetchTextOrNull(url: string): Promise<null | string> {
  try {
    const response = await fetch(url);

    return response.ok ? response.text() : null;
  } catch {
    return null;
  }
}

/** Load the `<name>_stream{0..count-1}.ipl` listed in the manifest for a basename. */
async function loadBinaryStreams(base: string, basename: string, manifest: StreamManifest): Promise<IplInstance[]> {
  const count = manifest[basename] ?? 0;
  const instances: IplInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const buffer = await fetchArrayBufferOrNull(streamIplUrl(base, basename, index));
    if (buffer !== null) {
      instances.push(...parseBinaryIpl(buffer));
    }
  }

  return instances;
}
