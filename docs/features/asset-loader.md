# Asset loader

`src/asset-loader/` — standalone, framework-agnostic (no React, no `game`). Turns the build's chunk
manifest into a cached, on-demand download pipeline. Plan [049](../plans/049-asset-loader.md).

## Implemented

- **Manifest** (`manifest.ts`, pure): `parseManifest` (validates the build's `{ chunks: { priority,
  models, textures }, game, version }` shape, throws on malformed data), `manifestDir`, `chunkUrl`,
  `allChunks` (flatten priority → models → textures, group-tagged), `chunkUrls`.
- **`AssetLoader`** (`asset-loader.ts`):
  - `init()` — fetches the manifest (`cache: 'no-store'`), then **invalidates** stale cache entries
    (URLs cached but absent from the manifest — old versions/hashes).
  - `load(groups?)` — **on demand**: ensures the given groups' chunks are present (default all);
    downloads missing chunks (streamed, with a concurrency limit), **skips any already cached**.
  - Per chunk: cache hit → deliver from cache, no network; miss → `fetch` (streamed for progress) →
    verify byte length (+ optional SHA-1 via `verifyHash`) → `cache.put` → deliver. Partial/failed
    downloads are never cached, so a later `load()` retries just that chunk.
  - Hands each ready chunk's **raw zip bytes** to an `AssetSink` (the VFS — next plan); the loader
    never unzips.
- **Progress** via its own typed emitter (`emitter.ts`): `progress` (global
  `{ loadedBytes, loadedChunks, totalBytes, totalChunks }`), `chunk` (per-chunk lifecycle:
  `cached`/`downloading`/`done`/`error`), `chunkReady`, `error`. Aggregation in `progress.ts` (pure).
- **Cache** (`cache-store.ts`): Cache Storage API, one named bucket, keyed by content-hashed chunk URL.
- **Invalidation diff** in `invalidate.ts` (pure: `staleKeys`).

## Virtual File System — `src/vfs/` (plan 050)

The `AssetSink` consumer. `Vfs` unzips each delivered chunk (fflate `unzipSync`) and indexes every entry
by name, then serves them behind `AssetFileSystem` (the read interface, defined in
`renderware/archive/asset-fs.ts` next to `ImgArchive` so renderware/game depend on the interface, not on
the VFS):

- `Vfs implements AssetSink, AssetFileSystem` — `addChunk(group, zipBytes)`, `get`/`getText`/`has`/`names`,
  `verify(manifest)` (delivered chunk + entry totals vs the manifest; `verify.ts` is pure-tested).
- **Keys** = names as packed: bare for model-archive files (`cj.dff`, `la.col`, `lae_stream0.ipl`) and
  relative paths for loose files (`data/gta.dat`, `text/american.gxt`).
- The game reads everything through `AssetFileSystem`: `resolve-map` (sync now), the world adapter
  (`fs.get`/`getText` for models/txd/data; binary IPL streams enumerated from `fs.names`), and
  `canvas-host` (zones/gxt/particle/effects/water/player/anim). `asset-cache` is unchanged — `AssetFileSystem`
  is a superset of the `ImgArchive` it already consumed.
- **Boot wiring:** the UI shell (`src/ui/shell/`, plan 051) — `use-asset-boot.ts` runs loader → `Vfs` →
  `verify` by phase (priority+models, then textures), and lazy-mounts `<CanvasHost fs={vfs} />`.

Test anchors: `src/vfs/verify.test.ts`, `src/vfs/vfs.test.ts`; full-boot smoke validated against the real
build output (loader → VFS → `resolveMap`).

## Known gaps / candidates

- **UI** (splash / preloader / progress bar bound to the events) — deferred (memory
  `loader-ui-out-of-scope`); the bootstrap shows plain text only.
- **Zone-lazy** (phase 2): per-chunk zone tag in the manifest; `load(groups)` is already partial, so
  it's additive.
- **Lazy per-file inflate** (keep raw chunks, decompress on `get`) behind the same interface, if the
  ~800 MB eager-unzip footprint bites.

## Test coverage anchors

- Unit: `manifest.test.ts`, `emitter.test.ts`, `progress.test.ts`, `invalidate.test.ts`.
- e2e (browser IO — `asset-loader.ts` + `cache-store.ts`, in vitest `coverage.exclude`):
  `e2e/asset-loader.spec.ts` (download/progress/sink, skip-if-cached, invalidation, error path).
