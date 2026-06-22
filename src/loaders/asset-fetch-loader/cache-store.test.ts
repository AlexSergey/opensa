import { describe, expect, it } from 'vitest';

import { CacheStore } from './cache-store';

// In the node test env (and on an insecure-context mobile browser) the Cache Storage API is absent, so the
// store must degrade to a no-op rather than throw `ReferenceError: caches is not defined`. The functional
// caching path is covered in-browser by `e2e/asset-fetch-loader.spec.ts`.
describe('CacheStore (no Cache Storage API)', () => {
  describe('positive cases', () => {
    it('degrades to a no-op when caches is unavailable — never throws, always a cache miss', async () => {
      const store = new CacheStore('opensa-assets-test');

      expect(await store.keys()).toEqual([]);
      expect(await store.match('https://example.test/chunk.zip')).toBeNull();
      await expect(store.put('https://example.test/chunk.zip', new Uint8Array(4))).resolves.toBeUndefined();
      await expect(store.delete('https://example.test/chunk.zip')).resolves.toBeUndefined();
      await expect(store.clear()).resolves.toBeUndefined();
    });
  });
});
