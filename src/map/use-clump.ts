import { use } from 'react';

import type { RWClump } from '../renderware';

import { parseDff } from '../renderware';

/**
 * Suspense-friendly cache of parsed DFF clumps, keyed by url.
 *
 * Unlike R3F's `useLoader` (which shares one mutable loader instance across all
 * call sites), this returns the renderer-agnostic {@link RWClump} with no loader
 * state, so concurrent instances can't race over textures. The textured Group is
 * built per instance in MapInstance once both the clump and its TXD are ready.
 */
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return parseDff(await response.arrayBuffer());
}
