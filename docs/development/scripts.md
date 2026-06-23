# Development scripts

Everything under `scripts/` with what it is for and real usage from past debugging sessions.
All TypeScript scripts run via `npx tsx`, `.mjs` ones via `node`.

## Contents

- [Build / asset pipeline](#build--asset-pipeline)
  - [build-game.ts](#build-gamets)
  - [gen-wind-list.ts](#gen-wind-listts)
  - [build-viewer-assets.ts](#build-viewer-assetsts)
  - [serve-static.ts](#serve-staticts)
  - [test-fixtures.ts](#test-fixturests)
- [Debugging / auditing](#debugging--auditing)
  - [audit-rw-coverage.ts](#audit-rw-coveragets)
  - [inspect-area.ts](#inspect-areats)
  - [find-instances.ts](#find-instancests)
  - [model-bbox.ts](#model-bboxts)
  - [check-cell-signs.ts](#check-cell-signsts)
  - [find-2dfx.ts](#find-2dfxts)
  - [dump-chunks.ts](#dump-chunksts)
  - [dump-texture.ts](#dump-texturets)
  - [dump-fx-system.ts](#dump-fx-systemts)
  - [solve-roadsign.ts](#solve-roadsignts)
  - [procobj-stats.ts](#procobj-statsts)
  - [wind-coverage.ts](#wind-coveragets)
  - [ide-flag-histogram.ts](#ide-flag-histogramts)
- [In-game debug URL params](#in-game-debug-url-params)

---

## Build / asset pipeline

### build-game.ts

Packs a variant (`game-src/<game>/`) into `static/<version>/` in four groups — data + models + textures

- others (`data/` folder · referenced `.dff` + every `.col` · referenced `.txd` · `.ipl`/`.ifp`/`.dat`
  from `gta3.img` + loose anim/text), each split into ~50MB content-hashed chunks (`game-build/chunk.ts`)
  listed in `manifest.json`. Every chunk gets a `cached` flag from the `CACHED` map (`data: false`, the rest
  `true`) — the runtime caches only `cached` chunks and treats the always-fresh `data` group as a build-liveness
  probe (a 404 there wipes the client cache; see [asset-loader.md](../features/asset-loader.md)). See plan 048
  for the full breakdown. It also reads the game's **TEMP** `mainCharacter` (`peds.ide`) + `vehicles`
  (`vehicles.ide`) from `GAME_CONFIG` (`src/game-config.tsx`, by `--game`) and packs them — dynamically-spawned
  models the map-placement partition would otherwise miss. Rebuild after changing them.

```sh
npm run build:game:original          # npm run timecyc && tsx scripts/build-game.ts --game original
tsx scripts/build-game.ts --game <name>   # any other variant
```

### gen-wind-list.ts

Regenerates the `WIND_MODELS` constant in `src/game/mods/wind-mode.ts` from the ground-truth
folder `game-src/wind/` (the set of models that must sway). Re-run after adding wind-adapted
models.

```sh
npx tsx scripts/gen-wind-list.ts
```

### build-viewer-assets.ts

Builds the standalone viewers' fixtures into **`static/viewer/`** by extracting from a clean, unmodified GTA
copy under `game-src/non-modified` (same source as `test-fixtures.ts`): `character/` (bmypol1 dff+txd + a
copied `ped.ifp`), `vehicles/` (admiral, comet), and `objects/` (the object-viewer's models + their txds, plus
a pre-baked `<model>.col.json` — map-object collision lives in the IMG, not the DFF). **Nothing under
`static/` is committed** (all of `static/` is gitignored); regenerate locally after a fresh clone. Local/dev
only (needs game-src). Re-run when the viewers' model lists or the COL parser change.

```sh
npm run viewer:assets               # tsx scripts/build-viewer-assets.ts
```

### serve-static.ts

The local + e2e static origin (`npm run serve:static`, port 3001 = `VITE_STATIC_URL`). Serves `static/`,
which holds the generated viewer fixtures (`/viewer/*`, `npm run viewer:assets`) and the built
`static/games/<game>-<version>/` archives — all gitignored. CORS is on; dev mode reads files fresh.

```sh
npm run serve:static                # tsx scripts/serve-static.ts
```

### timecyc-builder (`npm run timecyc`)

Build a custom `timecyc_24h.dat` by selectively merging donor timecyc files onto a base (by weather/zone,
hour, and property). Inputs may be vanilla or 24h (auto-converted). Config in `timecyc-builder/index.ts`;
output to `timecyc-builder/merged/`. **Full guide: [timecyc-builder.md](./timecyc-builder.md).**

```sh
npm run timecyc
```

### test-fixtures.ts

Regenerates the real-asset test fixtures (`tests/original/`) — Rockstar assets, **gitignored, not
redistributed**. Reads from a **clean, UNMODIFIED GTA San Andreas** copy at **`game-src/non-modified/`**:
copies loose data/text files, extracts entries from `models/*.img`, builds `img/admiral.img`, and generates
`models/effects` particle data + a stock `data/timecyc_24h.dat` (plain `convertTo24h`, no mod overlay).
Committed fixtures (mods + curated/version-pinned test models) live in `tests/custom/` and are untouched.

**Running the test suite requires this first** (CI has no game-src, so unit tests + e2e are disabled there):

```sh
npm run test:fixtures   # populate tests/original/ from game-src/non-modified
npm test                # then run the unit tests
```

Extend the `MANIFEST` in `scripts/test-fixtures.ts` when a test needs a new real-asset fixture.

---

## Debugging / auditing

These live under `scripts/debug/` and mirror `resolveMap` offline (fs instead of fetch) over a
variant's real assets in `game-src/<game>/` — models read straight from the stock `gta3.img` /
`gta_int.img` archives, data from `game-src/<game>/data/`. They share `scripts/lib/game.ts`
(`--game <name>`, default `original`) and must be run from the repo root (paths are cwd-relative).

### audit-rw-coverage.ts

Full RenderWare coverage audit: walks every DFF/TXD in the variant's archive and reports
what the data ACTUALLY contains vs what the parsers handle — DFF chunk-type histogram, the
complete 2dfx entry census, multi-UV-layer model count, parse failures; TXD format histogram and
how many textures the classifier drops. The ground truth behind plan 043.

```sh
npx tsx scripts/debug/audit-rw-coverage.ts [--game original]
```

Real use: established 13126/0-failure DFF coverage, the 36 dropped 16-bit textures, and the
prioritized parser gap list (particles, escalators, Breakable, HAnim, dual UV).

### inspect-area.ts

Area inspector for "model missing / black / not picked" bugs: lists every map instance within a
radius of a point with WHY it would (not) render — def present, LOD class, interior code, DFF in
archive, parse result, TXD presence.

```sh
npx tsx scripts/debug/inspect-area.ts <x> <y> [radius=120] [--game original]
npx tsx scripts/debug/inspect-area.ts 2908 -1058 60     # the pier-hole case
```

Real use: the `ce_grndpalcst05` pier hole — showed the placement existed and pointed onward to
the bbox check.

### find-instances.ts

Finds every placement of a model (or id) across ALL map IPLs — the text IPLs plus the binary
streams inside `gta3.img` — with the source of each. Companion to `inspect-area.ts`
for "ghost text placement vs real streamed placement" cases.

```sh
npx tsx scripts/debug/find-instances.ts <modelNameOrId> [...more] [--game original]
npx tsx scripts/debug/find-instances.ts se_bit_17 vegasnroad19
```

Real use: located the road-sign host instances and their interior=1024 area codes; resolved the
world-vs-local 2dfx coordinate question.

### model-bbox.ts

Prints a model's frame tree and DFF bbox (direct and frame-chained) vs its COL bbox. Diagnosis
rule: "collision present, mesh missing/floating elsewhere" → if DFF==COL the bug is
transform/culling; if raw-geometry==COL but a frame is non-identity, a junk frame translation is
being applied where SA would ignore it.

```sh
npx tsx scripts/debug/model-bbox.ts <model> [...more] [--game original]
npx tsx scripts/debug/model-bbox.ts ce_grndpalcst05
```

Real use: proved the pier-hole model shipped a stray (12.85, 317.05, −28.52) frame translation.

### check-cell-signs.ts

Reproduces the cell build's road-sign path offline: for a world position, lists the HD cell's
model groups, parses each clump from the variant's archive, and reports which carry 2dfx roadsign
entries — pinpoints where a missing sign drops out (def → grid → archive → parse).

```sh
npx tsx scripts/debug/check-cell-signs.ts <x> <y> [--game original]
npx tsx scripts/debug/check-cell-signs.ts 1300 -1700
```

Real use: proved the desert signs' data pipeline was clean, isolating the bug to rendering (the
glyph quad buried inside the board).

### find-2dfx.ts

Scans DFFs for 2d Effect entries: histograms entry types across the map and decodes every
ROADSIGN (type 7) — model, flags, plate size, rotation, position, text lines. Byte-stepped (a
4-byte stride misses unaligned chunks). Scans the variant's archive by default; `--img <path>`
scans a specific archive instead — diffing the two exposes re-export damage.

```sh
npx tsx scripts/debug/find-2dfx.ts | tail -50
npx tsx scripts/debug/find-2dfx.ts --img game-src/custom/models/gta3.img > 2dfx-custom.txt
```

Real use: the road-sign survey (112 entries / 43+ models), pinning the 88-byte entry layout
empirically, and PF-vs-original data comparison.

### dump-chunks.ts

Prints a RenderWare file's chunk tree (type, offset, size) — diagnoses WHERE a plugin chunk
lives (e.g. whether a 2d Effect is attached to a geometry extension or somewhere the runtime
parser doesn't look). The target is an archive entry (e.g. `se_bit_17.dff`) or a filesystem path.

```sh
npx tsx scripts/debug/dump-chunks.ts se_bit_17.dff
npx tsx scripts/debug/dump-chunks.ts se_bit_17.dff 253f2f8     # filter by chunk type
```

### dump-texture.ts

Dumps one texture from a TXD to PNG (no deps — software DXT1/3/5 decode + zlib IDAT). The TXD is
an archive entry (e.g. `particle.txd`) or a filesystem path. The `alpha` mode bakes the alpha
channel to opaque grayscale and reflows/zooms tall glyph strips — that is how the `roadsignfont`
atlas layout was read by eye.

```sh
npx tsx scripts/debug/dump-texture.ts particle.txd roadsignfont out.png alpha
```

### dump-fx-system.ts

Dumps one `effects.fxp` system: emitter prims with textures/blend ids and every keyframed
track. This is how the fire system's COLOURBRIGHT tracks (vs the usual COLOUR) and its
0→peak→0 alpha envelope were discovered (plan 044). Defaults to
`game-src/<game>/models/effects.fxp`; pass a path to override.

```sh
npx tsx scripts/debug/dump-fx-system.ts fire
npx tsx scripts/debug/dump-fx-system.ts water_fountain tests/data/effects.fxp
```

### solve-roadsign.ts

Brute-forces the road-sign plate transform: enumerates Euler orders × angle signs × angle→axis
maps × base plate triads and keeps combinations where EVERY observed rotation family renders
upright, lines-down and unmirrored. Found the unique convention (order Z→X→Y, base W=+X L=−Y
N=−Z) after hand calibration proved unreliable (90°-multiple rotations satisfy several wrong
conventions).

```sh
npx tsx scripts/debug/solve-roadsign.ts
```

### procobj-stats.ts

procobj scatter sanity counts for one cell: per model / per category, vanilla density
(lottery < 1) vs full 3× capacity, plus an area-weighted surface histogram (COL material id →
surfinfo name, m², rule matches, top contributing model). Needs `data/procobj.dat` and
`data/surfinfo.dat` in `game-src/<game>/`.

```sh
npx tsx scripts/debug/procobj-stats.ts -450 1500    # desert cell
```

Real use: confirmed the desert cell scatters cacti/bushes on the right surfaces and sized the
`procObjLimit` budget.

### wind-coverage.ts

Wind audit: compares the ground-truth `game-src/wind/` set against the runtime `WIND_MODELS`
constant, IDE vegetation flags and prelit-alpha weights — reports unweighted models, missing
list entries and alpha-rule false positives.

```sh
npx tsx scripts/debug/wind-coverage.ts [--game original]
```

Real use: exposed the 128 false positives of the alpha-as-trigger design (roads, LTS overlays,
piers), which led to the list-as-trigger redesign.

### ide-flag-histogram.ts

Histogram of IDE object-flag bits across every `.ide` under the variant's `data/maps`, with
example models per bit — to see which SA engine flags the renderer still ignores.

```sh
npx tsx scripts/debug/ide-flag-histogram.ts [--game original]
```

Real use: scoped plan 039 (which render-relevant flags to implement: DRAW_LAST, ADDITIVE,
NO_ZBUFFER_WRITE, DISABLE_BACKFACE_CULLING, IS_TREE/IS_PALM).

---

## In-game debug URL params

Not scripts, but part of the same toolbox:

- `?nocull=1` — disables frustum culling on every streamed mesh each frame; if a "missing" model
  appears, its bounding sphere (not the geometry) is the bug.
- `?shadowdebug=1` — paints the world-shadow term red and draws the sun shadow camera frustum
  (separates real shadows from SSAO / baked prelit darkening).
