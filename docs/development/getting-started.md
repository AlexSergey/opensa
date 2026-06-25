# Getting started

How to go from a clean checkout + your own copy of GTA: San Andreas to a running build.

The project ships **no game assets**. You supply them once from a legitimate GTA SA install; a build
step repacks them into compact archives under `static/`, and the app loads the game from there.

## 1. Prerequisites

- Node.js (see `.nvmrc` / `package.json` `engines` if present) and `npm`.
- A legitimate **GTA: San Andreas v1.0** install to copy assets from.

Install dependencies:

```sh
npm install
```

## 2. Provide the game assets — `game-src/original/`

Create `game-src/original/` and copy the relevant folders from your San Andreas install into it,
preserving the layout:

```
game-src/original/
  data/        # gta.dat, *.dat, *.ide, data/maps/**, surfinfo.dat, object.dat, timecyc.dat, …
  models/      # gta3.img, gta_int.img, effects.fxp, effectsPC.txd, particle.txd, generic/
  anim/        # ped.ifp and friends
  player/
  vehicles/
```

`original` is the base build for the current game version — **treat it as read-only** once populated
(it is the ground-truth source the build reads from). Notes:

- `models/gta3.img` is the primary archive; `models/gta_int.img` is overlaid as a fallback for the
  few interior props `gta3.img` lacks (the same override the build and dev scripts use).
- The build reads model/texture bytes **straight from the `.img` archives** — you do not extract them.
- Optional `data/timecyc_24h.dat` is used as-is when present; otherwise the vanilla `data/timecyc.dat`
  is converted to 24h at runtime.

To build a non-default variant (e.g. a mod set), drop it in `game-src/<name>/` with the same layout
and pass `--game <name>` to the build (see below).

## 3. Build the archives

```sh
npm run build:game:original              # → static/original-<version>/
# or, for any variant:
tsx scripts/build-game.ts --game <name>
```

`build:game:original` first regenerates `timecyc_24h.dat` (`npm run timecyc`), then packs
`game-src/original/` into `static/original-<version>/` (version comes from `package.json`). Each group
is split into **~50MB content-hashed chunks** (`<group>-<hash>.zip`) so a dropped download re-fetches
one chunk, not the whole group; `manifest.json` lists them:

- `data` — the contents of the loose `data/` folder (ide/ipl/dat/cfg/zon); no dff/txd/col.
- `models` — the `.dff` geometry the exterior map references (interiors excluded) + every `.col`.
- `textures` — the `.txd` textures the exterior map references (the bulk → ~10 chunks).
- `others` — everything else: `.ipl`/`.ifp`/`.dat` from `gta3.img` + loose anim/text (ifp/gxt/fxp).

Chunk assignment is a stable hash bucket, so changing one file leaves the other chunks byte-identical
(same hash/filename → the browser cache survives a version bump). See [build-flags.md](./build-flags.md)
and plan 048 for the full breakdown.

Each chunk also carries a `cached` flag from the build's `CACHED` map (`scripts/build-game.ts`). `models`,
`textures`, and `others` are cached in the browser (Cache Storage); `data` is `cached: false` — always
re-downloaded and never stored. That makes `data` a **build-liveness probe**: delete its zip on the server
(to revoke a build) and clients 404 on it, which wipes their whole asset cache. Deleting the whole build
(so `manifest.json` 404s) wipes the cache the same way. See [asset-loader.md](../features/asset-loader.md).

## 4. Run

```sh
npm run serve:static            # serves ./static (viewer fixtures + built game archives) at :3001 (VITE_STATIC_URL)
npm run dev                     # Vite dev server for the app
```

The app reads `VITE_STATIC_URL` (default `http://localhost:3001`, see `.env`). The UI shell (plans 051 / 056,
`src/ui/shell/`) shows a **menu of the games in `GAME_CONFIG`** (`src/game-config.tsx`); picking one runs its
disclaimer → the **asset loader** (plan 049) loads `static/<game>-<version>/` into the **VFS** (plan 050,
unzip + verify) → the lazily-loaded game runs entirely from the VFS.

> **Per-game config (`src/game-config.tsx`):** each game sets its `assetLoader` (`fetch` = download chunks;
> `local` = read a user-picked **raw GTA install**, Chromium only), `mainCharacter`, `vehicles`, `playerSpawn`,
> teleports, and a `disclaimer`. `original` is `local` (bring-your-own-files → "Choose game folder", remembered
> in IndexedDB); `gostown` is `fetch`. See [asset loaders](../features/asset-loader.md).

> **Note:** the boot fetches `static/<game>-${__APP_VERSION__}/manifest.json` for the picked game (version from
> `package.json`, wired in `src/ui/shell/use-asset-boot.ts`).

> **Testing on a phone (LAN):** Cache Storage needs a **secure context** (https / localhost). Over plain
> `http://<your-ip>:port` `caches` is undefined, so the loader skips caching and **re-downloads every visit**
> (it no longer crashes — see [asset loaders](../features/asset-loader.md)). For on-device caching, serve over
> https (Vite `server.https`) or a tunnel (ngrok / cloudflared).

## 5. Test fixtures (to run the test suite)

The real-asset test fixtures under `tests/original/` are Rockstar assets, so they are **not committed**
(gitignored) — regenerate them locally from an **unmodified** GTA SA copy placed at `game-src/non-modified/`:

```bash
npm run test:fixtures   # extracts/copies the needed files from game-src/non-modified into tests/original/
npm test                # now the unit tests have their fixtures
```

Custom (non-Rockstar) fixtures live in `tests/custom/` and are committed — no setup needed. A few fixtures
that can't be reproduced from a stock copy are also committed (see `scripts/test-fixtures.ts`). Re-run
`npm run test:fixtures` whenever you add a fixture to the manifest.

## 6. Viewer fixtures (for the standalone viewers + their e2e)

The standalone model viewers (`/viewer.html` — object/vehicle/character tabs via `?tab=`) and the
object-viewer e2e read from `static/viewer/`, which — like everything under `static/` — is **gitignored**.
Regenerate it by extracting from the same `game-src/non-modified/` copy:

```bash
npm run viewer:assets   # extracts character (bmypol1) + vehicles + objects (+ baked COL) into static/viewer/
```

## Where to go next

- [scripts.md](./scripts.md) — the build/asset pipeline and the offline debug tools under `scripts/debug/`.
- [build-flags.md](./build-flags.md) — viewer/debugger build flags.
- [e2e.md](./e2e.md) / [test-coverage.md](./test-coverage.md) — the test lanes.
