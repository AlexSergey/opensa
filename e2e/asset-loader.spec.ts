import { expect, type Page, test } from '@playwright/test';

/**
 * E2E for the asset loader's browser-IO shell (`src/asset-loader/asset-loader.ts` + `cache-store.ts`) —
 * real `fetch` streaming + Cache Storage, which node units can't exercise. Network is mocked with
 * `page.route` (no served fixtures needed); the loader doesn't parse the zip bytes, so fake chunk bodies
 * of the manifest-declared lengths are enough. Runs on the Vite origin so `import('/src/...')` resolves
 * and Cache Storage is available.
 */
const ORIGIN = 'http://localhost:3001';
const DIR = `${ORIGIN}/loader-e2e`;
const MANIFEST_URL = `${DIR}/manifest.json`;
const CACHE_NAME = 'opensa-assets-e2e';
const MODULE = '/src/asset-loader/index.ts';

const manifest = {
  chunks: {
    models: [{ bytes: 6, entries: 1, file: 'models-bbbb.zip', hash: 'bbbb' }],
    priority: [{ bytes: 4, entries: 1, file: 'priority-aaaa.zip', hash: 'aaaa' }],
    textures: [{ bytes: 8, entries: 2, file: 'textures-cccc.zip', hash: 'cccc' }],
  },
  game: 'test',
  version: 'test-1',
};
const lengthByFile: Record<string, number> = { 'models-bbbb.zip': 6, 'priority-aaaa.zip': 4, 'textures-cccc.zip': 8 };

interface RunResult {
  delivered: [string, number][];
  keys: string[];
  progress: { loadedBytes: number; loadedChunks: number; totalBytes: number; totalChunks: number };
  statuses: string[];
}

/** Mock the manifest + chunk responses; `fail404` returns 404 for that one chunk file. */
async function mockNetwork(page: Page, fail404?: string): Promise<void> {
  await page.route(MANIFEST_URL, (route) =>
    route.fulfill({ body: JSON.stringify(manifest), contentType: 'application/json' }),
  );
  await page.route(`${DIR}/*.zip`, (route) => {
    const file = route.request().url().split('/').pop() ?? '';
    if (file === fail404) {
      return route.fulfill({ status: 404 });
    }

    return route.fulfill({ body: Buffer.alloc(lengthByFile[file], 1), contentType: 'application/zip' });
  });
}

/** Run a fresh AssetLoader (init + load all) in the page and report what happened. */
function run(page: Page): Promise<RunResult> {
  return page.evaluate(
    async ({ cacheName, manifestUrl, module }) => {
      interface LoaderModule {
        AssetLoader: new (config: {
          cacheName?: string;
          manifestUrl: string;
          sink?: { addChunk(group: string, bytes: Uint8Array): void };
        }) => {
          events: { on(event: string, handler: (payload: unknown) => void): void };
          init(): Promise<unknown>;
          load(): Promise<void>;
        };
      }
      const mod = (await import(/* @vite-ignore */ module)) as LoaderModule;
      const statuses: string[] = [];
      const delivered: [string, number][] = [];
      let progress = { loadedBytes: 0, loadedChunks: 0, totalBytes: 0, totalChunks: 0 };
      const loader = new mod.AssetLoader({
        cacheName,
        manifestUrl,
        sink: {
          addChunk: (group, bytes): void => {
            delivered.push([group, bytes.length]);
          },
        },
      });
      loader.events.on('chunk', (event): void => {
        statuses.push((event as { status: string }).status);
      });
      loader.events.on('progress', (event): void => {
        progress = event as RunResult['progress'];
      });
      await loader.init();
      await loader.load();
      const cache = await caches.open(cacheName);
      const keys = (await cache.keys()).map((request) => request.url);

      return { delivered, keys, progress, statuses };
    },
    { cacheName: CACHE_NAME, manifestUrl: MANIFEST_URL, module: MODULE },
  );
}

test.describe('asset loader', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate((name) => caches.delete(name), CACHE_NAME);
  });

  test('downloads every chunk, reports progress, caches, and delivers to the sink', async ({ page }) => {
    await mockNetwork(page);
    const result = await run(page);

    expect(result.statuses.filter((s) => s === 'done')).toHaveLength(3);
    expect(result.delivered.map(([, len]) => len).sort((a, b) => a - b)).toEqual([4, 6, 8]);
    expect(result.progress).toEqual({ loadedBytes: 18, loadedChunks: 3, totalBytes: 18, totalChunks: 3 });
    expect(result.keys).toHaveLength(3);
  });

  test('skips chunks already in the cache on a second run', async ({ page }) => {
    await mockNetwork(page);
    await run(page); // warms the cache
    const second = await run(page);

    expect(second.statuses).toHaveLength(3);
    expect(second.statuses.every((s) => s === 'cached')).toBe(true);
    expect(second.delivered).toHaveLength(3); // still delivered to the sink, from cache
  });

  test('invalidates cached chunks no longer in the manifest', async ({ page }) => {
    await mockNetwork(page);
    const remaining = await page.evaluate(
      async ({ cacheName, dir, manifestUrl, module }) => {
        interface LoaderModule {
          AssetLoader: new (config: { cacheName?: string; manifestUrl: string }) => { init(): Promise<unknown> };
        }
        const cache = await caches.open(cacheName);
        await cache.put(`${dir}/stale-9999.zip`, new Response(new Uint8Array(2)));
        const mod = (await import(/* @vite-ignore */ module)) as LoaderModule;
        await new mod.AssetLoader({ cacheName, manifestUrl }).init();

        return (await cache.keys()).map((request) => request.url);
      },
      { cacheName: CACHE_NAME, dir: DIR, manifestUrl: MANIFEST_URL, module: MODULE },
    );

    expect(remaining).not.toContain(`${DIR}/stale-9999.zip`);
  });

  test('rejects and emits an error when a chunk fails to download', async ({ page }) => {
    await mockNetwork(page, 'textures-cccc.zip');
    const outcome = await page.evaluate(
      async ({ cacheName, manifestUrl, module }) => {
        interface LoaderModule {
          AssetLoader: new (config: { cacheName?: string; manifestUrl: string }) => {
            events: { on(event: string, handler: (payload: unknown) => void): void };
            load(): Promise<void>;
          };
        }
        const mod = (await import(/* @vite-ignore */ module)) as LoaderModule;
        const loader = new mod.AssetLoader({ cacheName, manifestUrl });
        let errorFile = '';
        loader.events.on('error', (event): void => {
          errorFile = (event as { file: string }).file;
        });
        let rejected = false;
        await loader.load().catch(() => {
          rejected = true;
        });

        return { errorFile, rejected };
      },
      { cacheName: CACHE_NAME, manifestUrl: MANIFEST_URL, module: MODULE },
    );

    expect(outcome.rejected).toBe(true);
    expect(outcome.errorFile).toBe('textures-cccc.zip');
  });
});
