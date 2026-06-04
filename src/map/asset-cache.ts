import type { RWClump, TextureDictionary } from '../renderware';
import type { ImgArchive } from './img-archive';

import { buildTextureMap, parseDff, parseTxd } from '../renderware';

/**
 * Parse models/textures out of the in-memory WIMG archive, cached by name.
 *
 * Synchronous (the archive is already downloaded), so there's no per-model
 * fetch/Suspense. A name absent from the archive (or unparseable) yields an
 * empty clump / empty texture map — it renders nothing instead of crashing.
 */
const EMPTY_CLUMP: RWClump = { atomics: [], frames: [], geometries: [] };

const clumpCache = new Map<string, RWClump>();

const textureCache = new Map<string, TextureDictionary>();

export function getClump(archive: ImgArchive, modelName: string): RWClump {
  const key = `${modelName.toLowerCase()}.dff`;
  let clump = clumpCache.get(key);
  if (!clump) {
    clump = parseOrEmpty(archive.get(key), parseDff, EMPTY_CLUMP);
    clumpCache.set(key, clump);
  }

  return clump;
}

export function getTextures(archive: ImgArchive, txdName: string): TextureDictionary {
  const key = `${txdName.toLowerCase()}.txd`;
  let textures = textureCache.get(key);
  if (!textures) {
    textures = parseOrEmpty(archive.get(key), (buffer) => buildTextureMap(parseTxd(buffer)), new Map());
    textureCache.set(key, textures);
  }

  return textures;
}

function parseOrEmpty<T>(buffer: ArrayBuffer | null, parse: (buffer: ArrayBuffer) => T, empty: T): T {
  if (!buffer) {
    return empty;
  }
  try {
    return parse(buffer);
  } catch {
    return empty;
  }
}
