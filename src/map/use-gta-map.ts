import { use } from 'react';

import type { IplInstance, MapDefinitions } from '../gta-sa-parsers';

import { parseBinaryIpl, parseGtaDat, parseIde, parseIpl } from '../gta-sa-parsers';
import { datChildUrl, iplBasename, normalizeDatPath, streamIplUrl } from './resolve-paths';

/** Suspense-friendly cache so `use()` reads a stable promise per (base, datUrl). */
const cache = new Map<string, Promise<MapDefinitions>>();

/**
 * Load and resolve a whole map: parse gta.dat, merge all IDE object definitions
 * into a catalog, and concatenate all IPL instances. Designed to be read under
 * `<Suspense>` via React's `use()`.
 */
export function useGtaMap(datUrl: string, base: string): MapDefinitions {
  const key = `${base}::${datUrl}`;
  let promise = cache.get(key);
  if (!promise) {
    promise = loadMap(datUrl, base);
    cache.set(key, promise);
  }

  return use(promise);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

/** Probe <base>/ipl_binary/<name>_stream{0,1,…}.ipl until one is missing. */
async function loadBinaryStreams(base: string, basename: string): Promise<IplInstance[]> {
  const instances: IplInstance[] = [];
  for (let index = 0; ; index += 1) {
    const response = await fetch(streamIplUrl(base, basename, index));
    if (!response.ok) {
      break;
    }
    instances.push(...parseBinaryIpl(await response.arrayBuffer()));
  }

  return instances;
}

async function loadMap(datUrl: string, base: string): Promise<MapDefinitions> {
  const dat = parseGtaDat(await fetchText(datUrl));

  const catalog: MapDefinitions['catalog'] = new Map();
  for (const idePath of dat.ide) {
    for (const def of parseIde(await fetchText(datChildUrl(base, idePath)))) {
      catalog.set(def.id, def);
    }
  }

  const instances: IplInstance[] = [];
  for (const iplPath of dat.ipl) {
    instances.push(...parseIpl(await fetchText(datChildUrl(base, iplPath))));
    // Full-detail placement lives in the matching binary stream IPLs (named
    // <ipl>_stream<N>.ipl), extracted from the IMG into static/ipl_binary.
    instances.push(...(await loadBinaryStreams(base, iplBasename(iplPath))));
  }

  return { catalog, imgDirs: dat.img.map(normalizeDatPath), instances };
}
