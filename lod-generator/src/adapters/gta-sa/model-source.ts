import type { RWClump } from '../../../../src/renderware/parsers/binary/types';
import type { Archive } from './io';

import { parseDff } from '../../../../src/renderware/parsers/binary/dff';

/** Resolves a model name to its parsed clump, loaded on demand from the archives and cached. */
export interface ModelSource {
  /** The parsed clump for `model` (with or without a `.dff` suffix), or null if absent / unparseable. */
  load(model: string): null | RWClump;
}

/**
 * Build a {@link ModelSource} over the opened archives: look up `<model>.dff` across them, parse with the engine
 * `parseDff` (read-only) and memoize. A missing or unparseable model caches as null (logged once) so the bake
 * skips it instead of retrying — the same model is instanced many times across cells.
 */
export function createModelSource(archives: readonly Archive[]): ModelSource {
  const cache = new Map<string, null | RWClump>();

  return {
    load(model: string): null | RWClump {
      const key = model.toLowerCase();
      const cached = cache.get(key);
      if (cached !== undefined || cache.has(key)) {
        return cached ?? null;
      }
      const name = key.endsWith('.dff') ? key : `${key}.dff`;
      let clump: null | RWClump = null;
      for (const archive of archives) {
        const buffer = archive.get(name);
        if (buffer) {
          clump = tryParse(buffer, name);
          break;
        }
      }
      cache.set(key, clump);

      return clump;
    },
  };
}

function tryParse(buffer: ArrayBuffer, name: string): null | RWClump {
  try {
    return parseDff(buffer);
  } catch (error) {
    console.warn(`lod-generator: skipping ${name} — ${(error as Error).message}`);

    return null;
  }
}
