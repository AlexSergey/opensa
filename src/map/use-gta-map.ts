import { use } from 'react';

import type { IplInstance, MapDefinitions } from '../gta-sa-parsers';

import { parseGtaDat, parseIde, parseIpl } from '../gta-sa-parsers';
import { datChildUrl, normalizeDatPath } from './resolve-paths';

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
  }

  return { catalog, imgDirs: dat.img.map(normalizeDatPath), instances };
}
