# 054 — Per-chunk cache policy + build revoke

Each manifest chunk carries a **`cached`** boolean (set offline by the build) telling the runtime whether to
persist it in Cache Storage. Cacheable groups (`models`/`textures`/`others`) are stored and re-used across
visits; the **`data`** group is `cached: false` — always re-fetched, never stored — so it doubles as a
**build-liveness probe**: deleting its zip on the server (to revoke a build) makes clients 404 on it, which
**wipes their whole asset cache**. The fetch loads the probe **before** any cacheable chunk, so the wipe is
**atomic**. Builds on [048](./048-game-build-archives.md) (build groups) + [049](./049-asset-loader.md) (fetch
loader). **Status: ✅ DONE (2026-06-22).**

> **Implemented:** `ChunkInfo.cached` (`src/loaders/types.ts`) + validation in `manifest.ts`; build writes it
> from a `CACHED` map in `scripts/build-game.ts` (`{ data: false, models: true, others: true, textures: true }`).
> `AssetFetchLoader.load` runs two passes — non-cached chunks first, then cacheable concurrently; `fetchChunk`
> only touches Cache Storage when `chunk.cached`, and on a non-cached failure calls the new `CacheStore.clear()`.
> The local loader's synthesised manifest sets `cached: false` (it never caches). Tests: `manifest.test.ts`
> (cached validation), e2e `asset-fetch-loader.spec.ts` (data re-fetched / not persisted, probe-before-cacheable
> ordering, 404-on-data wipes the cache). Feature doc: `docs/features/asset-loader.md`.

## Why

Content-hashed chunk names already bust the cache on a **version bump** (a changed chunk gets a new URL, and
`init()` evicts the orphaned old URL via `staleKeys`). But there was no way to **revoke the current version** —
to force every client on `<game>-<version>` to drop its cached HD assets without bumping the version. We also
want the small, cheap `data` group (ide/ipl/dat — world layout + config) to always reflect the server, since
it is the source of truth the heavier models/textures are selected against.

Making `data` non-cached solves both: it is re-fetched every boot (cheap, ~0.5 MB), and its absence is an
unambiguous "this build is gone" signal we can act on.

## Design

- **Manifest** — every chunk is `{ bytes, cached, entries, file, hash }`. `cached` comes from the build's
  `CACHED: Record<GroupName, boolean>` map; `parseManifest` rejects a non-boolean `cached`.
- **Caching** (`asset-fetch-loader.ts`) — `fetchChunk` reads from / writes to Cache Storage only when
  `chunk.cached`. Non-cached chunks are always downloaded fresh and never stored.
- **Revoke** — when a non-cached chunk fails to download (404 or any error), the loader calls
  `CacheStore.clear()` (drops the whole bucket) and rejects. The boot's core phase therefore fails and retries,
  and the client holds no stale cached chunks.
- **Atomicity** — `load` partitions the requested chunks into `[non-cached, cacheable]` and awaits the
  non-cached pass **before** starting the cacheable pass. So if the `data` probe fails, the wipe happens before
  any cacheable `put`, and no chunk can race back into the cache after it — independent of `concurrency`.

## Scope

- **In scope:** the `cached` field end-to-end (build → manifest → fetch loader), the two-phase `load`, and the
  revoke-on-data-failure wipe. The per-group policy lives in one place (`CACHED` in the build).
- **Out of scope:** server tooling to perform a revoke (it is just "delete `data-<hash>.zip`"); per-chunk TTLs
  or partial invalidation; changing the version-bump invalidation path (`staleKeys`), which is unchanged.

## Notes

- The local loader (`VITE_ASSET_LOADER=local`) reads from disk every boot and never uses Cache Storage, so its
  synthesised manifest marks every group `cached: false` (the value is inert there).
- `data` being non-cached costs one extra small round-trip at the head of the core phase before the big
  models/textures downloads start — negligible, and it makes a revoke fail fast.
