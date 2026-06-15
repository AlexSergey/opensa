/**
 * Thin Cache Storage wrapper: the loader caches each RAW zip chunk as a Response keyed by its URL, so a
 * returning visit (or a retry after a blip) reads it back instead of re-downloading. Browser-only API —
 * exercised on the Playwright e2e lane, not in node units.
 */
export class CacheStore {
  constructor(private readonly name: string) {}

  /** Remove a cached chunk by URL. */
  async delete(url: string): Promise<void> {
    const cache = await caches.open(this.name);
    await cache.delete(url);
  }

  /** Every cached chunk URL (for invalidation diffing). */
  async keys(): Promise<string[]> {
    const cache = await caches.open(this.name);

    return (await cache.keys()).map((request) => request.url);
  }

  /** Cached bytes for a chunk URL, or null when not cached. */
  async match(url: string): Promise<null | Uint8Array<ArrayBuffer>> {
    const cache = await caches.open(this.name);
    const response = await cache.match(url);

    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  /** Store a fully-downloaded, verified chunk under its URL. */
  async put(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const cache = await caches.open(this.name);
    await cache.put(url, new Response(bytes));
  }
}
