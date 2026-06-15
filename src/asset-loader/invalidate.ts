/**
 * Cache invalidation diff (pure): which cached chunk URLs are no longer referenced by the current
 * manifest and should be evicted. Content-hashed file names mean a changed chunk gets a new URL, so its
 * old URL falls out of the manifest and shows up here.
 */
export function staleKeys(cachedUrls: Iterable<string>, manifestUrls: Iterable<string>): string[] {
  const valid = new Set(manifestUrls);
  const stale: string[] = [];
  for (const url of cachedUrls) {
    if (!valid.has(url)) {
      stale.push(url);
    }
  }

  return stale;
}
