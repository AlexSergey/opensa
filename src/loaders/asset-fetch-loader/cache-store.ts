/**
 * Thin Cache Storage wrapper: the loader caches each RAW zip chunk as a Response keyed by its URL, so a
 * returning visit (or a retry after a blip) reads it back instead of re-downloading. Browser-only API —
 * exercised on the Playwright e2e lane, not in node units.
 *
 * The Cache Storage API needs a **secure context** (https / localhost) — it is absent over plain `http://`
 * (e.g. a phone hitting a LAN IP), where `caches` is not even defined. So every method degrades to a no-op
 * when it is unavailable: nothing is cached and the loader simply re-downloads each visit (see `available`).
 */
export class CacheStore {
  /** `false` when the Cache Storage API is unavailable (insecure context) — all ops become no-ops. */
  private readonly available = typeof caches !== 'undefined';

  constructor(private readonly name: string) {}

  /** Drop the entire cache bucket — used to revoke a build (the always-fresh `data` group failed to fetch). */
  async clear(): Promise<void> {
    if (this.available) {
      await caches.delete(this.name);
    }
  }

  /** Remove a cached chunk by URL. */
  async delete(url: string): Promise<void> {
    if (!this.available) {
      return;
    }
    const cache = await caches.open(this.name);
    await cache.delete(url);
  }

  /** Every cached chunk URL (for invalidation diffing); empty when caching is unavailable. */
  async keys(): Promise<string[]> {
    if (!this.available) {
      return [];
    }
    const cache = await caches.open(this.name);

    return (await cache.keys()).map((request) => request.url);
  }

  /** Cached bytes for a chunk URL, or null when not cached / unavailable (forces a fresh download). */
  async match(url: string): Promise<null | Uint8Array<ArrayBuffer>> {
    if (!this.available) {
      return null;
    }
    const cache = await caches.open(this.name);
    const response = await cache.match(url);

    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  /** Store a fully-downloaded, verified chunk under its URL (no-op when caching is unavailable). */
  async put(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!this.available) {
      return;
    }
    const cache = await caches.open(this.name);
    await cache.put(url, new Response(bytes));
  }
}
