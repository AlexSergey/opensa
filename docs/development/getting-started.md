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

- `priority` — loose data/player/vehicles/anim + world files (col/ipl/ifp/dat); no dff/txd.
- `models` — the `.dff` geometry the exterior map references (interiors excluded).
- `textures` — the `.txd` textures the exterior map references (the bulk → ~10 chunks).

Chunk assignment is a stable hash bucket, so changing one file leaves the other chunks byte-identical
(same hash/filename → the browser cache survives a version bump). See [build-flags.md](./build-flags.md)
and plan 048 for the full breakdown.

## 4. Run

```sh
npm run serve:static            # serves ./static at http://localhost:3001 (VITE_STATIC_URL)
npm run dev                     # Vite dev server for the app
```

The app reads `VITE_STATIC_URL` (default `http://localhost:3001`, see `.env`). The UI shell (plan 051,
`src/ui/shell/`) boots instantly, then the **asset loader** (plan 049) downloads the chunks from
`static/<game>-<version>/` (caching each in Cache Storage), the **VFS** (plan 050) unzips them and
verifies against the manifest, and the lazily-loaded game runs entirely from the VFS. A network blip
re-fetches only the dropped chunk; a return visit downloads nothing.

> **Note:** the boot fetches `static/original-${__APP_VERSION__}/manifest.json` (version from
> `package.json`, wired in `src/ui/shell/use-asset-boot.ts`) — currently the `original` variant only.

## Where to go next

- [scripts.md](./scripts.md) — the build/asset pipeline and the offline debug tools under `scripts/debug/`.
- [build-flags.md](./build-flags.md) — viewer/debugger build flags.
- [e2e.md](./e2e.md) / [test-coverage.md](./test-coverage.md) — the test lanes.
