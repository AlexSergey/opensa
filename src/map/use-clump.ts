import { use } from 'react';

import type { RWClump } from '../renderware';

import { parseDff } from '../renderware';

/**
 * Suspense-friendly cache of parsed DFF clumps, keyed by url.
 *
 * Unlike R3F's `useLoader` (which shares one mutable loader instance across all
 * call sites), this returns the renderer-agnostic {@link RWClump} with no loader
 * state, so concurrent models can't race over textures. A missing model resolves
 * to an empty clump (renders nothing) rather than crashing the whole map.
 */
const EMPTY_CLUMP: RWClump = { atomics: [], frames: [], geometries: [] };

const cache = new Map<string, Promise<RWClump>>();

export function useClump(url: string): RWClump {
  let promise = cache.get(url);
  if (!promise) {
    promise = loadClump(url);
    cache.set(url, promise);
  }

  return use(promise);
}

async function loadClump(url: string): Promise<RWClump> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return EMPTY_CLUMP;
    }

    return parseDff(await response.arrayBuffer());
  } catch {
    return EMPTY_CLUMP; // network failure / unparseable — render nothing
  }
}
