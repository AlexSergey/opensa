import type { ImgArchive } from '../archive/img-archive';
import type { ColModel } from '../parsers/binary/col-types';

import { parseColLibrary } from '../parsers/binary/col';

/** Lowercased model name → its collision model, flattened across all `.col` libraries. */
export type CollisionIndex = Map<string, ColModel>;

const COL_SUFFIX = '.col';

// Built once per archive (the archive is already in memory; parsing every
// library is a single pass we don't want to repeat on each region load).
const indexCache = new WeakMap<ImgArchive, CollisionIndex>();

/**
 * Build a name → collision-model index from every `.col` library in the WIMG
 * archive. Collision binds to placed objects by model name (like the dff/txd
 * lookup), so models from all libraries are flattened into one map keyed by
 * lowercased name; the first occurrence of a name wins. A library that fails to
 * parse is skipped — it contributes no collision rather than crashing the index.
 * Cached per archive, so repeat calls are free.
 */
export function buildCollisionIndex(archive: ImgArchive): CollisionIndex {
  const cached = indexCache.get(archive);
  if (cached) {
    return cached;
  }

  const index: CollisionIndex = new Map();
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith(COL_SUFFIX)) {
      continue;
    }
    const buffer = archive.get(name);
    if (!buffer) {
      continue;
    }
    for (const model of parseSafe(buffer)) {
      const key = model.name.toLowerCase();
      if (!index.has(key)) {
        index.set(key, model);
      }
    }
  }
  indexCache.set(archive, index);

  return index;
}

/** Look up the collision model for a placed object's model name, or null if none. */
export function getCollision(index: CollisionIndex, modelName: string): ColModel | null {
  return index.get(modelName.toLowerCase()) ?? null;
}

function parseSafe(buffer: ArrayBuffer): ColModel[] {
  try {
    return parseColLibrary(buffer);
  } catch {
    return [];
  }
}
