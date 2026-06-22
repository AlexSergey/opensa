# Asset loaders

`src/loaders/` — standalone, framework-agnostic (no React, no `game`). Resolves the game's assets into the
VFS behind one contract, selected at build time by `VITE_ASSET_LOADER`. Plans
[049](../plans/049-asset-loader.md) (fetch) + [053](../plans/053-asset-local-loader.md) (local + restructure).

## Layout

```
src/loaders/
  index.ts            # createAssetLoader(config) factory (env switch) + public re-exports
  types.ts            # shared contract: AssetLoader + Manifest/GroupName/AssetSink/ProgressSnapshot/…
  manifest.ts         # manifest helpers (parseManifest, allChunks, chunkUrl, …) — pure
  emitter.ts          # typed event emitter   |   progress.ts — ProgressTracker (pure)
  asset-fetch-loader/ # AssetFetchLoader (manifest + chunk download)  + cache-store.ts, invalidate.ts
  asset-local-loader/ # AssetLocalLoader (user-picked raw GTA install) + dir-handle-store, img-reader, …
```

The boot flow (`use-asset-boot.ts`) drives **one** `AssetLoader` from `createAssetLoader(...)`; everything
downstream (VFS, renderer) is loader-agnostic. `resolveLoaderKind()` reads `VITE_ASSET_LOADER` (`fetch`
default | `local`).

```ts
interface AssetLoader {
  readonly events: Emitter<AssetLoaderEvents>;
  init(): Promise<Manifest>; // fetch+parse manifest / prompt+scan the install
  load(groups?: readonly GroupName[]): Promise<void>; // make groups present in the VFS sink
  prepare?(): Promise<void>; // local only: the user-gesture folder prompt
  restore?(): Promise<void>; // local only: boot-time restore of the remembered folder
  ready?(): boolean; // local only: folder acquired?
}
```

## Fetch loader (`asset-fetch-loader/`, plan 049)

Turns the build's chunk manifest into a cached, on-demand download pipeline.

- **Manifest** (`manifest.ts`, pure): `parseManifest` (validates `{ chunks: { data, models, others, textures },
game, version }`; each chunk is `{ bytes, cached, entries, file, hash }`), `manifestDir`, `chunkUrl`, `allChunks`
  (data → others → models → textures, group-tagged), `chunkUrls`. `GROUP_NAMES` is the load order; `CORE_GROUPS`
  (everything but textures) is the first boot phase.
- **`AssetFetchLoader`**: `init()` fetches the manifest (`cache: 'no-store'`) then **invalidates** stale cache
  entries; `load(groups?)` ensures the given groups' chunks are present (download streamed, concurrency-limited,
  **skips cached**), verifying byte length (+ optional SHA-1). Partial/failed downloads are never cached.
  Hands each ready chunk's **raw zip bytes** to the `AssetSink` (the VFS); never unzips.
- **Caching policy** (per-chunk `cached`, set by the build's `CACHED` map): `cached: true` chunks
  (models/textures/others) are read from / written to Cache Storage. `cached: false` chunks (the `data`
  group) are **always re-fetched** and never stored — `data` doubles as a **build-liveness probe**.
  `load` fetches the non-cached probe **before** any cacheable chunk; if it fails (e.g. the server returns
  404 because the build was revoked), the loader **wipes the entire cache** (`CacheStore.clear`) and rejects.
  Doing the probe first makes the wipe atomic — no cacheable chunk can race back in after it.
- **Cache** (`cache-store.ts`): Cache Storage, one named bucket, keyed by content-hashed chunk URL.
  **Invalidation** in `invalidate.ts` (pure `staleKeys`); **`clear()`** drops the whole bucket (revoke).
  Cache Storage needs a **secure context** (https / localhost); over plain `http://` (e.g. a phone on a LAN
  IP) `caches` is undefined, so every op degrades to a no-op — nothing is cached and assets re-download each
  visit (no crash).

## Local loader (`asset-local-loader/`, plan 053)

Reads a **user-picked raw GTA San Andreas install** folder via the File System Access API and converts it
in-browser to the same VFS — so the downstream flow is identical. **Chromium-only; opt-in** via
`VITE_ASSET_LOADER=local`.

- **Folder handle** (`dir-handle-store.ts`): persisted in IndexedDB and remembered across visits.
  `restoreDir` (boot, no gesture) loads it; `pickDir` (the Play-folder gesture) makes the picker /
  `requestPermission` its **first** await so the user activation isn't lost across an IndexedDB read.
- **Lazy IMG reader** (`img-reader.ts`): reads only the VER2 directory up front, then slices each needed
  entry's byte range from disk — never buffers the ~1 GB `gta3.img`. VER2 parsing shared from
  `renderware/archive`.
- **Selection** (`build-vfs.ts`): the in-browser port of `scripts/build-game.ts`'s partition (shared
  `src/game-build/partition.ts` — `partitionEntries` + `looseGroup`) — exterior-placed models/textures,
  `.col`, the loose `data/`/anim/text files, and the `gta3.img` ipl/ifp/dat, **plus** the env-named dynamic
  models (`VITE_MAIN_CHARACTER` via `peds.ide`, `VITE_VEHICLES` via `vehicles.ide`).
- **`AssetLocalLoader`**: `restore()` (mount) → `prepare()` (Play-folder gesture) → `init()` (scan+select →
  one synthetic chunk per group) → `load()` (read selected bytes into the VFS, count-based progress).
- **Boot gate**: the shell auto-loads `core` for fetch; for local it boots to the menu, then **Play → folder
  prompt** (`FolderPrompt`, `boot-machine` `folder` phase) → load. See [ui-shell](ui-shell.md).

## Progress + events

Typed emitter (`emitter.ts`): `progress` (global `{ loadedBytes, loadedChunks, totalBytes, totalChunks }`),
`chunk` (per-chunk `cached`/`downloading`/`done`/`error`), `chunkReady`, `error`. Fetch aggregates bytes;
local emits count-based progress per file.

## Virtual File System — `src/vfs/` (plan 050)

The `AssetSink` consumer. `Vfs implements AssetSink, AssetFileSystem`:

- `addChunk(group, file, zipBytes)` — unzip (fflate) + index by name (fetch loader).
- `addFiles(chunkId, entries)` — raw ingest of already-unzipped name→bytes (local loader), accounting like
  `addChunk` so `verify(manifest)` works against the local loader's **synthesised** manifest.
- `get`/`getText`/`has`/`names`; `verify(manifest)` (delivered chunk + entry totals; `verify.ts` is pure).
- **Keys** = names as packed: bare for archive files (`cj.dff`, `la.col`), relative paths for loose files
  (`data/gta.dat`). The game reads everything through `AssetFileSystem`.

## Known gaps / candidates

- Local loader is **Chromium-only** (File System Access); `fetch` stays the default everywhere else.
- The env-named peds/vehicles selection is a **temporary** bring-your-own-files stop-gap (plan 053 step 7)
  until a proper ped/vehicle registry exists.
- Lazy per-file inflate for the fetch path (decompress on `get`) if the eager-unzip footprint bites.

## Test coverage anchors

- Unit: `loaders/{manifest,emitter,progress}.test.ts`, `asset-fetch-loader/invalidate.test.ts`,
  `asset-local-loader/{dir-handle-store,img-reader,build-vfs,asset-local-loader}.test.ts`, `vfs/{verify,vfs}.test.ts`.
- e2e (browser IO): `e2e/asset-fetch-loader.spec.ts` (download/progress/sink, skip-if-cached, invalidation,
  error) and `e2e/asset-local-loader.spec.ts` (fake FSA tree → walk + lazy reader + selection + VFS, verify clean).
