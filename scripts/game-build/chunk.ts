/**
 * Split a build group (textures/models/…) into roughly equal ~50MB chunks so a dropped download
 * re-fetches one chunk, not the whole 500MB archive (the loader caches per chunk).
 *
 * Assignment is a **stable hash bucket** (`fnv1a(name) % N`, `N = ceil(total / target)`): an entry's
 * bucket depends only on its own name + N, so changing one file leaves the other chunks byte-identical
 * (their content hash — hence filename — stays the same and the browser cache survives a version bump).
 * A greedy fill of a sorted list would shift every boundary on a single insert and bust the cache.
 */

/** Target chunk size: ~50MB downloaded per chunk. */
export const TARGET_CHUNK_BYTES = 50 * 1024 * 1024;

/**
 * Group entries into `chunkCount(total)` buckets by `fnv1a(name) % N`, dropping empty buckets.
 * Sizes come out ~equal (many entries); the grouping is stable under add/remove of other entries.
 */
export function chunkByHash<T extends { name: string; size: number }>(
  entries: readonly T[],
  targetBytes = TARGET_CHUNK_BYTES,
): T[][] {
  const total = entries.reduce((sum, entry) => sum + entry.size, 0);
  const count = chunkCount(total, targetBytes);
  const buckets: T[][] = Array.from({ length: count }, () => []);
  for (const entry of entries) {
    buckets[fnv1a(entry.name) % count].push(entry);
  }

  return buckets.filter((bucket) => bucket.length > 0);
}

/** Number of chunks for a group of `totalBytes` (at least one). */
export function chunkCount(totalBytes: number, targetBytes = TARGET_CHUNK_BYTES): number {
  return Math.max(1, Math.ceil(totalBytes / targetBytes));
}

/** 32-bit FNV-1a hash of `text` (unsigned). Deterministic across runs/platforms. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
