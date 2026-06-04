import { use } from 'react';

import type { TextureDictionary } from '../renderware';

import { buildTextureMap, parseTxd } from '../renderware';

/**
 * Suspense-friendly cache of TXD texture dictionaries, keyed by url. Stateless
 * (no shared loader to race over) and tolerant: a missing TXD resolves to an
 * empty map so the model simply renders untextured instead of crashing.
 */
const cache = new Map<string, Promise<TextureDictionary>>();

export function useTextures(url: string): TextureDictionary {
  let promise = cache.get(url);
  if (!promise) {
    promise = loadTextures(url);
    cache.set(url, promise);
  }

  return use(promise);
}

async function loadTextures(url: string): Promise<TextureDictionary> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return new Map();
    }

    return buildTextureMap(parseTxd(await response.arrayBuffer()));
  } catch {
    return new Map(); // network failure / unparseable — render untextured
  }
}
