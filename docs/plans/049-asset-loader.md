# 049 — Asset loader

A standalone module that turns the build's chunk manifest into a cached, on-demand download pipeline.
It fetches `manifest.json`, downloads the chunk zips **on request**, **caches them per chunk**
(skipping any already cached), handles **invalidation**, reports **progress** (global + per chunk) via
its own event emitter, and hands each ready chunk's raw bytes to a **Virtual File System** through a
small interface — the loader itself never touches React or the game. **Status: ✅ DONE (2026-06-15).**

> **Implemented:** `src/asset-loader/` — pure + unit-tested `manifest.ts` / `emitter.ts` / `progress.ts` /
> `invalidate.ts`; browser-IO shell `asset-loader.ts` + `cache-store.ts` (vitest `coverage.exclude`, covered by
> `e2e/asset-loader.spec.ts` — download/progress/sink, skip-if-cached, invalidation, error path; mocks network
> via `page.route`, runs on the Vite origin). Feature doc: `docs/features/asset-loader.md`. The VFS (the
> `AssetSink` consumer) + game rewire is the next plan.

Builds on [048](./048-game-build-archives.md) (the chunked build output) and the agreed chunking design
(memory `texture-chunking-decision`).

## Scope (decided 2026-06-15)
- **In scope:** the loader only — manifest fetch/parse, on-demand chunk download, Cache Storage caching
  + skip-if-cached, invalidation, progress emitter, and the **handoff contract** to the VFS.
- **VFS:** only its **interface** is defined here (the sink the loader pushes raw zip bytes into). The VFS
  implementation (unzip → in-memory FS → `get(name)`/`names` the game already speaks) is the **next plan**.
- **Out of scope:** any UI (splash / preloader / progress bar) — a later plan once the game is playable
  (memory `loader-ui-out-of-scope`); rewiring game/adapter/`resolve-map` off loose-`fetch` onto the VFS;
  zone-based lazy loading (phase 2, see Future).
- **Standalone:** lives in `src/asset-loader/`, depends on nothing in `src/ui` or `src/game`.

## Why
The textures group alone is ~496 MB across ~10 chunks. A monolithic download means one network blip
re-fetches everything. Per-chunk download + Cache Storage means a blip costs one ~50 MB chunk, returning
visits download nothing, and a version bump re-downloads only the chunks whose content (hence hash/name)
changed. The loader is the runtime half of that promise (the build is done).

## Manifest contract (already produced by the build)
`static/<game>-<version>/manifest.json`:
```jsonc
{
  "chunks": {
    "priority": [{ "bytes": 27888674, "entries": 723,  "file": "priority-0f7e8a8c1066.zip", "hash": "0f7e8a8c1066" }],
    "models":   [{ "bytes": 18694017, "entries": 2298, "file": "models-bdf9e83c02bf.zip",   "hash": "bdf9e83c02bf" }, ...],
    "textures": [{ "bytes": ...,      "entries": ...,  "file": "textures-2a7909a5bfec.zip",  "hash": "2a7909a5bfec" }, ...]
  },
  "game": "original",
  "version": "original-0.1.0"
}
```
Chunk files sit next to `manifest.json` → a chunk's URL = `dirname(manifestUrl) + '/' + file`. Filenames
are content-hashed (immutable); the `hash`/`bytes` fields let the loader verify integrity.

## Module layout — `src/asset-loader/`
Pure logic split out so it's unit-testable; the browser-IO shell (fetch streaming + Cache Storage) is thin
and covered by e2e (per the `gl-dom-coverage-exclusion` convention).

- `types.ts` — `Manifest`, `ChunkInfo`, `GroupName` (`'priority' | 'models' | 'textures'`), event payloads,
  and `AssetSink` (the VFS handoff contract).
- `manifest.ts` — **pure**: `parseManifest(json)` (validate shape, throw on bad data), `chunkUrl(dir, info)`,
  `allChunks(manifest)` (flatten with group tag), `chunkUrls(manifest, dir)`.
- `emitter.ts` — **pure**: tiny typed emitter (`on`/`off`/`emit`), no DOM/`EventTarget` dependency.
- `progress.ts` — **pure**: `ProgressTracker` — register chunk totals, record per-chunk bytes, derive the
  global `{ loadedBytes, totalBytes, loadedChunks, totalChunks }` snapshot.
- `invalidate.ts` — **pure**: `staleKeys(cachedUrls, manifestUrls)` → URLs to evict (in cache, not in manifest).
- `cache-store.ts` — **shell**: Cache Storage wrapper (`match`/`put`/`keys`/`delete` over a named cache).
- `asset-loader.ts` — **shell**: the `AssetLoader` orchestrator wiring the above.
- `index.ts` — barrel (public surface).

## Public API
```ts
interface AssetLoaderConfig {
  manifestUrl: string;       // full URL to manifest.json (caller knows game+version, e.g. `${BASE}/original-0.1.0/manifest.json`)
  sink?: AssetSink;          // where ready chunk bytes go (the VFS); optional so the loader is usable/testable alone
  cacheName?: string;        // Cache Storage bucket, default 'opensa-assets'
  verifyHash?: boolean;      // default false — length is always checked; SHA-1 check optional (crypto.subtle)
  concurrency?: number;      // parallel downloads, default 4
}

class AssetLoader {
  constructor(config: AssetLoaderConfig);
  readonly events: Emitter<AssetLoaderEvents>;
  init(): Promise<Manifest>;                 // fetch+parse manifest (no-store), then invalidate stale cache
  load(groups?: GroupName[]): Promise<void>; // on-demand: ensure these groups' chunks are present; default = all
}
```
- **On demand:** the caller decides *when* to pull *what* — e.g. `load(['priority'])` at boot, then
  `load(['models','textures'])` on Start. This is also the seam for future zone-lazy loading.
- **Manifest fetch** uses `cache: 'no-store'` (source of truth, fixed name). Chunks are immutable → our
  Cache Storage owns them.

## Download flow (per chunk, within a concurrency limit)
1. `url = chunkUrl(dir, info)`.
2. **Cached?** `cacheStore.match(url)` hit → emit `chunk {status:'cached'}`, read its bytes, push to
   `sink.addChunk(group, bytes)`, count it as fully loaded. **No network** (already cached → skip).
3. **Miss** → `fetch(url)`, read `response.body` via a reader, accumulating bytes and emitting per-chunk +
   global byte progress as they arrive (smooth progress, not a single jump).
4. On completion verify `bytes.length === info.bytes` (and SHA-1 === `info.hash` when `verifyHash`). On pass:
   `cacheStore.put(url, new Response(bytes))`, emit `chunk {status:'done'}`, push to `sink.addChunk(...)`.
5. On fetch/verify error: emit `chunk {status:'error'}` + `error`; **never cache a partial** (only the full,
   verified Response is put). The chunk stays "missing" so a later `load()` retries just it.

## Progress events (own emitter)
`AssetLoaderEvents`:
- `progress` — global `{ loadedBytes, totalBytes, loadedChunks, totalChunks }` for the active `load()` set.
- `chunk` — per chunk `{ group, file, status: 'cached'|'downloading'|'done'|'error', loadedBytes, totalBytes }`.
- `chunkReady` — `{ group, file, bytes }` (observability; the primary handoff is `sink.addChunk`).
- `error` — `{ file, error }`.

Global progress comes from `ProgressTracker` (pure): each chunk's `info.bytes` seeds the total; cached
chunks land as fully-loaded immediately; downloading chunks update incrementally.

## Caching & invalidation (Cache Storage API, raw zip)
- One named cache (`cacheName`). Key = chunk **URL** (content-hashed filename → globally unique).
- **Skip-if-cached:** a `match` hit means identical content (hash in the name) → trust it, skip download.
- **Invalidation (in `init`):** after parsing the manifest, `staleKeys(await cache.keys(), manifestUrls)`
  → `cache.delete` each. This drops chunks from prior versions (different hash) and old version dirs, so the
  cache never grows unbounded across rebuilds. (Optional later: a soft "verify cached `bytes` length on hit".)

## VFS handoff contract (defined here, implemented next plan)
```ts
interface AssetSink {
  /** Accept a fully-downloaded, integrity-checked RAW zip chunk; the VFS unzips + indexes it. */
  addChunk(group: GroupName, zipBytes: Uint8Array): void | Promise<void>;
}
```
The loader caches **raw zips** and never unzips — unzipping + name indexing is the VFS's job. The VFS (next
plan) will implement `AssetSink` and expose an `ImgArchive`-shaped reader (`get(name): ArrayBuffer | null`,
`names: string[]`) serving both bare model/txd names (`cj.dff`, `cj.txd`) and loose paths (`data/gta.dat`,
`models/effects.fxp`) — the same shapes the game already consumes today via `openArchive` + direct `fetch`.

## Testing
Per `tests-mandatory` + `gl-dom-coverage-exclusion`:
- **Unit (vitest):** `parseManifest` (negative: malformed/missing fields; positive: valid), `chunkUrl`/`chunkUrls`,
  `staleKeys` diff, `ProgressTracker` aggregation, `emitter` on/off/emit. All pure, deterministic.
- **e2e (Playwright):** `cache-store.ts` + `asset-loader.ts` (real `fetch` + Cache Storage) against a tiny
  served fixture (a manifest + 1–2 small zips under a test static dir): asserts skip-if-cached, progress
  events fire, invalidation evicts a stale key, and `sink.addChunk` receives each chunk. Add those two shell
  files to vitest `coverage.exclude` with the e2e banner.

## Steps
1. `types.ts` + `manifest.ts` (+ tests).
2. `emitter.ts`, `progress.ts`, `invalidate.ts` (+ tests).
3. `cache-store.ts` (Cache Storage wrapper).
4. `asset-loader.ts` (orchestrator: init → invalidate; load → concurrency + per-chunk flow).
5. `index.ts` barrel.
6. e2e for the shell + coverage.exclude entries.
7. Docs: `docs/features/asset-loader.md`; mention in `docs/development/getting-started.md` (how the app will
   consume archives once loader+VFS are wired).

## Future (not now)
- **Zone-lazy (phase 2):** add a per-chunk zone tag to the manifest; `load(groups)` already supports partial
  fetch, so on-demand-by-area is additive — no loader rewrite.
- **VFS + game rewire:** separate plan; flips `resolve-map`/adapter/`canvas-host` from loose `fetch` to the VFS.
- **UI:** splash/preloader bound to the progress events — separate plan (`loader-ui-out-of-scope`).
```
