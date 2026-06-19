# 053 — Pluggable asset loaders + local raw-install loader

## Context

Today a single `AssetLoader` (`src/asset-loader/`) drives boot: `init()` fetches `manifest.json` from
`VITE_STATIC_URL/games/<game>-<version>/`, `load(groups)` streams the content-hashed **chunk zips** into the
VFS sink (`Vfs.addChunk` → `unzipSync` → name→bytes map), and the game reads everything **synchronously** via
`fs.get(name)`. The chunk layout is produced offline by `scripts/build-game.ts` (opens `gta3.img`/`gta_int.img`,
selects the exterior-placed models from IPL/IDE, packs loose files + model/texture entries into ~50 MB zips).

We want a **second** loader that reads a **raw GTA San Andreas install folder** the user picks at runtime
(`models/gta3.img`, `data/`, `anim/ped.ifp`, `player/…`), converts it in-browser to the same in-memory VFS,
and then the **downstream flow is identical** (same `AssetFileSystem`, same renderer). Loader chosen by an env
var. The pick must be remembered (no re-prompt) unless it becomes invalid (folder deleted / permission lost).

## Decision

- New folder **`src/loaders/`** holding both loaders behind one contract; selected by **`VITE_ASSET_LOADER`**
  (`fetch` default | `local`).
- The current loader **moves** to `src/loaders/asset-fetch-loader/` (class `AssetLoader` → `AssetFetchLoader`),
  unchanged in behaviour.
- The local loader is essentially **`build-game.ts` running in the browser, minus zipping** — it populates the
  VFS directly. The partition logic is **shared**, not duplicated.
- Keep `fs.get` **synchronous**: do all async work (File reads) during the load phase, materialising only the
  **selected** entries (exterior-placed models + loose files) into memory — never the whole ~1 GB `gta3.img`.

## Target structure

```
src/loaders/
  index.ts          # createAssetLoader(config) factory (env switch) + public re-exports
  types.ts          # shared contract: AssetLoader interface + Manifest/GroupName/AssetSink/
                    #   ProgressSnapshot/ChunkInfo/GroupChunk/ChunkStatus/AssetLoaderEvents
  manifest.ts       # shared manifest helpers (parseManifest, allChunks, chunkUrl, …)
  emitter.ts        # shared Emitter
  progress.ts       # shared ProgressTracker
  asset-fetch-loader/
    asset-fetch-loader.ts   # class AssetFetchLoader implements AssetLoader (was asset-loader.ts)
    cache-store.ts
    invalidate.ts
    index.ts
    *.test.ts
  asset-local-loader/
    asset-local-loader.ts   # class AssetLocalLoader implements AssetLoader
    dir-handle-store.ts     # IndexedDB persistence of the FileSystemDirectoryHandle + permission flow
    img-reader.ts           # lazy VER2 IMG reader over a FileSystemFileHandle (directory + range slices)
    build-vfs.ts            # in-browser port of build-game: partition → name→bytes
    *.test.ts
```

The shared **`AssetLoader`** contract (both implement):

```ts
interface AssetLoader {
  readonly events: Emitter<AssetLoaderEvents>;
  init(): Promise<Manifest>; // local: prompt/restore dir + scan; returns a synthesised manifest
  load(groups?: readonly GroupName[]): Promise<void>; // local: read selected bytes into the VFS
}
```

Consumers (`vfs.ts`, `vfs/verify.ts`, `ui/shell/*`) import shared types from `../loaders` instead of
`../asset-loader`. `Vfs` gains a raw-ingest path (`addFile(name, bytes)` / bulk) the local loader uses instead
of `addChunk(zip)`.

## Local-loader flow

1. **Pick & persist the folder.** On the **Play click** (transient user activation is required), call
   `showDirectoryPicker({ mode: 'read' })`. Persist the returned `FileSystemDirectoryHandle` in **IndexedDB**
   (`opensa-loader` store, key `gameDir`) — handles are structured-cloneable. On a later visit, restore it and
   `queryPermission({ mode: 'read' })`; if `'prompt'`, `requestPermission` (also gesture-bound); if the handle
   is missing, the folder is gone, or permission is denied → re-prompt with `showDirectoryPicker`.
2. **Open the IMG archives lazily** (`img-reader.ts`). Read only the VER2 directory header (`8 + count*32`
   bytes) from `models/gta3.img` via `handle.getFile()` → `file.slice(0, dirLen).arrayBuffer()`, build
   `name → [offset, size]`, and fetch each needed entry on demand with `file.slice(off, off+size)`. Same for
   the optional `models/gta_int.img` (override). Reuse the **VER2 parsing** from
   `src/renderware/archive/img-archive.ts` (factor the directory parse so it works on a header slice).
3. **Partition (shared).** Move `scripts/game-build/partition.ts` → `src/game-build/partition.ts` (it only uses
   pure `renderware` parsers — node-free) and have both `build-game.ts` and the loader import it. Parse placed
   instance ids (text IPL under `data/` except `interior/`, plus binary IPL streams inside `gta3.img`), the IDE
   `id → {model, txd}` map, then `placedModels` + `partitionEntries` → the `priority` / `models` / `textures`
   buckets, exactly as the build.
4. **Read loose files.** Walk the picked dir tree via directory handles (skip `models/gta3.img`,
   `models/gta_int.img`, `anim/anim.img`, `.DS_Store`) → VFS keyed by lowercased relative path.
5. **Materialise model/texture entries** from the IMG buckets → VFS keyed by bare lowercased name.
6. **Progress + phases.** Emit the same `progress`/`chunk` events so the existing preloader works, mapped to the
   same three groups (`priority`, `models`, `textures`) the boot machine already sequences. `init()` returns a
   **synthesised `Manifest`** (counts of what was selected) so `Vfs.verify` keeps working; or `verify` is made a
   no-op for the local loader.

## Steps (phased)

1. **Restructure + contract + factory + env** (no behaviour change) — **DONE**: created `src/loaders/`, `git mv`
   `src/asset-loader` → `src/loaders/asset-fetch-loader`, hoisted shared `types/manifest/emitter/progress` to
   `src/loaders/`, renamed class to `AssetFetchLoader`, added the `AssetLoader` interface + `createAssetLoader`
   factory + `resolveLoaderKind`, `VITE_ASSET_LOADER` in `vite-env.d.ts`, repointed all imports, wired
   `use-asset-boot.ts` through the factory. `AssetLocalLoader` is a stub that throws until phases 2–5 land.
   Full suite green (795).
2. **Dir handle store** (`dir-handle-store.ts`) — **DONE**: IndexedDB save/restore/clear + per-handle
   `queryPermission`/`requestPermission` + `isDirReadable` (deleted-folder detection via `values().next()`).
   Split into **`restoreDir(deps)`** (boot, no gesture — load + query-permission, report `{ handle, ready }`)
   and **`pickDir(deps, stored)`** (gesture — see the gesture fix below). Both dependency-injected, unit-tested
   without IDB/FSA; `browserDirHandleDeps()` wires the real APIs. Missing lib.dom types
   (`queryPermission`/`requestPermission`/`showDirectoryPicker`) added in `file-system-access.d.ts`.

   **Gesture fix (critical):** `showDirectoryPicker`/`requestPermission` require live user activation, which is
   **lost across a task-crossing `await`** — and IndexedDB events resolve on the task queue. The first attempt
   read the stored handle from IDB _before_ prompting, so the picker threw `SecurityError: Must be handling a
user gesture`. Fixed by splitting boot vs gesture: `restore()` runs at app mount (loads the handle into
   memory, no gesture); `prepare()` runs in the **Play click** and makes the permission request / picker its
   **first** async call (no IDB await before it). A re-denied stored handle is forgotten so the next click
   prompts afresh.

3. **Lazy IMG reader** (`img-reader.ts`) — **DONE**: `openLazyVer2(source)` reads the VER2 directory up front
   (header → entry count → `count×32` slice) then slices each entry's range on demand — never buffers the ~1 GB
   archive. VER2 directory parsing is shared from `renderware/archive` (`parseVer2Directory` +
   `ver2DirectoryLength`/`ver2EntryCount`, factored out of `openVer2`). Byte access is abstracted behind
   `ByteRangeSource` (unit-tested over an in-memory `buildVer2Buffer`, asserting laziness); `fileHandleSource`
   wires a real `FileSystemFileHandle` (`getFile()` → `file.slice().arrayBuffer()`).
4. **Shared partition** — **DONE**: `git mv scripts/game-build/partition.ts` → `src/game-build/partition.ts`
   (+ its test; node-free, only renderware parsers), repointed `build-game.ts`. Added
   `asset-local-loader/build-vfs.ts` — the in-browser selection port: `selectInstallEntries(source)` computes
   placed ids (text IPLs under `data/` not `interior/` + binary IPL streams in gta3.img) → `ideById` →
   `placedModels` → `partitionEntries` (same buckets as the build), and `readEntry(source, entry)` materialises
   one entry from the resolved archive. Reached through an `InstallSource` abstraction (lazy gta3/gta_int +
   loose file list/read), unit-tested over fakes (placed-only selection, gta_int override, missing-entry).
5. **VFS raw ingest + boot integration** — **DONE**: `Vfs.addFiles(chunkId, entries)` raw-ingests pre-unzipped
   files, accounting like `addChunk` so `verify` works against a synthesised manifest (added to `AssetSink`).
   `install-source.ts` wires the FSA `InstallSource` (one directory walk → handle index, lazy gta3/gta_int,
   on-demand loose reads). `AssetLocalLoader` is fully implemented: `prepare()` (the gesture-bound folder
   prompt), `init()` (scan+select → one synthetic chunk per group), `load(groups)` (read each group's files
   into the sink, count-based `progress` events), `restore()` (boot reload of the remembered handle). `AssetLoader`
   gained optional `prepare()` + `restore()`; `use-asset-boot` calls `loader.restore?.()` in a mount effect (no
   gesture) and `loader.prepare?.()` inside the **Play click** before dispatching (so the picker keeps its user
   activation — see the phase-2 gesture fix; a cancelled/denied prompt stays on the menu). Fetch path unchanged
   (no `prepare`/`restore`). Seams (`acquireDir`/`openSource`/`restoreDir`) make all methods unit-tested w/o FSA.

   **Boot-flow gate (gesture-first):** the shell **auto-loads the `core` phase on mount** (priority+models, with
   the intro) — i.e. BEFORE any click; Play only gates the later textures phase. So the local loader can't
   prompt from the core effect (no gesture → the picker throws). Fix: `useAssetBoot` exposes `needsFolder` +
   `chooseFolder` and a `folderReady` gate — for a loader with `prepare`, the load effect waits until the folder
   is acquired. `restore()` runs on mount (may flip it ready with no prompt); otherwise `app.tsx` shows a
   `FolderPrompt` (a gesture button) during `core`, whose click runs `chooseFolder → prepare()` and unblocks
   loading. Fetch loader: `folderReady` starts true, so nothing changes.

6. **Tests + e2e** — **DONE**: unit tests across phases 2–5 (`dir-handle-store` via injected deps, `img-reader`
   synthetic VER2 **+ a real `tests/original/img/admiral.img` parity test** gated by `existsSync`, `build-vfs`
   selection, `AssetLocalLoader` init/load/prepare). Fixed the existing fetch e2e broken by the move
   (`e2e/asset-loader.spec.ts` → `asset-fetch-loader.spec.ts`, repointed to `/src/loaders` + `AssetFetchLoader`).
   New `e2e/asset-local-loader.spec.ts` runs the **real** browser pipeline (directory walk + lazy VER2 reader +
   selection + ingest into a real `Vfs`, `verify` clean) over a fake FSA tree — the only injected seam is
   `acquireDir`, since `showDirectoryPicker` is a native dialog Playwright can't drive. All green (817 unit, 5 e2e).

## Risks / constraints

- **Browser support:** File System Access (`showDirectoryPicker`, handle persistence) is **Chromium-only**.
  `local` is opt-in via env; `fetch` stays the default for Firefox/Safari/prod.
- **User activation:** `showDirectoryPicker` / `requestPermission` must run inside the Play click handler — the
  boot hook currently triggers loading from an effect; phase 5 routes the picker through the gesture.
- **Memory:** never hold the full archive — lazy range reads + select-then-materialise keep peak at the chosen
  subset (hundreds of MB). Same selection as the shipped build, so parity is testable.
- **Sync `fs.get` preserved:** all File I/O happens in `load()`; the VFS stays a synchronous in-memory map, so
  the renderer/adapter are untouched — "the flow is identical" downstream.

## Step 7 — dynamic peds/vehicles stop-gap (TEMPORARY)

The partition only selects models **placed on the map** (IPL/IDE). Peds and vehicles are spawned dynamically,
so a raw install yields a VFS with no player/car models → the game can't start. Stop-gap until a proper
ped/vehicle registry exists:

- **Selection — only what's named in `.env`** (not all peds): `selectInstallEntries(source, { peds, vehicles })`
  resolves the named peds (`peds.ide` → `parsePedDefs`) and vehicles (`vehicles.ide` → `parseVehicleDefs`),
  adding their `model.dff`/`txd.txd` to the models/textures buckets. `peds = [VITE_MAIN_CHARACTER]` and
  `vehicles = VITE_VEHICLES` flow via `createAssetLoader` → `AssetLocalLoader`.
- **Offline build parity**: `scripts/build-game.ts` does the same — `loadEnv` reads the local `.env`,
  `dynamicRefs(dataDir, VITE_MAIN_CHARACTER, VITE_VEHICLES)` merges those into the partition refs before
  packing, so the fetch archives also contain the chosen character + cars. The env-list parsing is shared
  (`src/game-build/env-list.ts` `parseModelList`, used by both `game-config.ts` and the builder).
- **Runtime** (`game-config.ts` exposes `MAIN_CHARACTER`, `VEHICLES`): the player loads via
  `adapter.loadCharacterByModel(VITE_MAIN_CHARACTER)` (resolve `peds.ide` → bare `model.dff`/`txd.txd`), else
  the loose `player/*` fallback. `loadVehicle` now tries loose `vehicles/<name>` then the bare archive name
  (`requireFirstBuffer`), so cars load in both fetch (loose) and local (raw) modes. The debug spawn list uses
  `VITE_VEHICLES` when set.
- Env: `VITE_MAIN_CHARACTER=BMYPOL1`, `VITE_VEHICLES=['admiral','comet']` (or `admiral,comet`).

## Out of scope (v1)

Caching the _parsed_ VFS between sessions (re-scan each load is acceptable first); non-Chromium fallback;
reading a raw install over the network. Related: [[052-hanim-skeleton-mapping]] is independent.
