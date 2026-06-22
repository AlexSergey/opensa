# 048 — Game build archives (`build:<game>`)

A build script that packs a game variant from `game-src/<game>/` into **three compressed archives** for a
staged web load: **priority** (loose data + world layout — menu shows / streams in the background),
**models** (all `.dff` geometry), and **textures** (all `.txd`). Output to `./static/<version>/`. (The
LoaderManager that consumes these — and decides load order — is a later task.) **Scope: only the `original`
variant** (the script still takes `--game`, but we build/verify `original`). **Status: ✅ DONE (2026-06-14).**

> **Implemented:** `scripts/build-game.ts` (shell) + `scripts/game-build/partition.ts` (pure, tested) +
> `npm run build:game` / `build:original`. `fflate` added to deps; `scripts/**/*.test.ts` added to vitest
> `include`. Verified `original` (**3 archives**): **priority.zip ~26 MB** (123 loose + 593 world files
> col/ipl/ifp/dat, NO dff/txd) + **models.zip ~87 MB** (11319 `.dff`) + **textures.zip ~496 MB** (1664 `.txd`)
>
> - `manifest.json`, into `static/original-0.1.0/`; **45 files come from `gta_int.img`** (override). All three
>   read back valid and pairwise disjoint. **Anim:** the stock
>   `anim/anim.img` is excluded; `ped.ifp` ships loose and is loaded **directly** at runtime (no anim pack —
>   `pack:anim`/`animations.img` removed; `loadAnimations(ifpUrl)` fetches `anim/ped.ifp`).
>   **Gotcha:** fflate's _streaming_ `Zip` produced a corrupt archive on this data (unzip → "invalid distance");
>   switched to `zipSync` (in-memory, build run with `NODE_OPTIONS=--max-old-space-size`), which is correct.
>   `.txd` stored, the rest deflated (level 6).

> **Update (2026-06-22) — four groups.** The single `priority` bucket was split, so the build now emits
> **four** groups (`GROUP_NAMES = data → others → models → textures`; `CORE_GROUPS` = all but textures):
> **data** (the loose `data/` folder only — ide/ipl/dat/cfg/zon), **models** (referenced `.dff` **+ every
> `.col`** — collision pairs with the geometry), **textures** (referenced `.txd`), **others** (`.ipl`/`.ifp`/
> `.dat` from `gta3.img` + loose anim/text — ifp/gxt/fxp). Loose files are bucketed by the shared
> `looseGroup()` helper (so the build and the local loader agree); the override-archive world files split the
> same way (`.col` → models, ipl/ifp/dat → others). Each chunk also gets a `cached` boolean from a `CACHED`
> map (`data: false`, the rest `true`) so the runtime can skip caching `data` and use it as a build-liveness
> probe (see plan 049's update note). The body below describes the original 3-group, no-`cached` design.

## Why

The full game is too heavy for one download. Split it so the app boots + shows the menu while the priority
data downloads, then fetch the HD models/textures only when the player presses Start.

## Input — `game-src/<game>/`

`<game>` = a folder name under `game-src/` (e.g. `original`, `custom`). Layout (verified for `original`):

- `data/` — `gta.dat`, `*.ide` (57), `*.dat`, `maps/**` (text IPL/IDE), carcols, handling, procobj, zon, …
- `player/`, `vehicles/`, `anim/`, `models/generic/**`, `models/particle.txd`, `models/*.fxp`
- Two stock SA VER2 model archives (both read by our `openArchive`), each an O(1) name→bytes store:
  - `models/gta3.img` — the **primary** source: dff 12964, txd 2759, col 216, ipl 164, ifp 149, dat 64.
  - `models/gta_int.img` — a **secondary OVERRIDE/fallback** source (the plan-005 "multiple source folders,
    later overrides earlier" pattern): dff 1901, txd 517, col 35, ipl 26, ifp 5. We do **not** take all of it —
    only the **referenced** files that are **missing from `gta3.img`** (a small, content-driven handful: the
    map's gym/RC/cargo/airport interior-style props that live in gta_int). Everything else in gta_int (the bulk
    of the interiors) is ignored.

  **Sizing note (verified, important):** the plan-005 figure "only 7 missing (gym/RC props)" was relative to
  the **old pre-merged `static/img/gta3` dump**, not the raw `gta3.img`. Against the raw archives, the
  exterior map (text IPLs outside `interior/` + binary IPL streams) references **~30 dff + ~15 txd** that are
  only in `gta_int.img`; the plan-005 seven are a subset. So the gta_int contribution is **data-driven** (a
  few dozen files), not a hardcoded 7 and not the whole archive.

## Output — `./static/<version>/`

`version` = a single folder segment `"<game>-<pkgVersion>"` (e.g. `original-0.1.0`) — no separate `<game>`
segment in the path. Contents:

- `priority.zip`, `models.zip`, `textures.zip` (below).
- `manifest.json` — `{ game, version, priority|models|textures: {file, bytes, entries} }`. The **version** is
  what the future LoaderManager caches by, so a returning user who already has it doesn't re-download.
  (`static/` is served by `serve:static` / `VITE_STATIC_URL`.)

## The three archives (the partition)

Every entry is keyed the way the engine looks it up: **model entries by bare lowercased name** (`cj.dff`,
`lan_stream5.ipl` — matches today's `archive.get('x.dff')`); **loose files by their path** under
`game-src/<game>` (`data/maps/LA/LAn.ide`, `vehicles/admiral.dff`, `models/generic/vehicle.txd`). Each
referenced dff/txd is resolved **`gta3.img` first, then `gta_int.img` as fallback** (override pattern); the
chosen bytes are written under the bare name regardless of which img they came from. The three archives are
**disjoint** and split by file kind (so the loader can fetch/stage them independently):

- **`priority.zip`** — all loose files under `game-src/<game>` **except** the model archives and the stock
  `anim/anim.img` (data/, player/, vehicles/, `anim/ped.ifp` loaded directly, models/generic/**, particle.txd,
  \*.fxp, …) **plus** the world layout from `gta3.img`: every `.col`, `.ipl`, `.ifp`, `.dat`. **No dff/txd.\*\*
- **`models.zip`** — every referenced `.dff` (gta3 → gta_int fallback).
- **`textures.zip`** — every referenced `.txd` (gta3 → gta_int fallback).

### How the referenced set is computed

1. **Placed models, not all IDE defs.** Collect the model ids actually instanced by the IPLs the variant loads
   (text IPLs under `data/maps` + the binary IPL streams in `gta3.img`; `parseIpl` / `parseBinaryIpl`), then
   resolve each id → `(modelName, txdName)` via the IDEs (`parseIde` id map). Filtering by _placed_ instances
   (what streaming actually requests) — not every IDE row — is what keeps unplaced/interior defs out.
2. For each referenced base name: locate `name.dff`/`name.txd` in `gta3.img` else `gta_int.img` (else drop —
   referenced but in neither). dff → `models.zip`; txd → `textures.zip`; `col/ipl/ifp/dat` (gta3.img) →
   `priority.zip`. (No LOD/HD split — all referenced geometry goes to `models.zip`, all textures to
   `textures.zip`; LOD vs HD streaming is a runtime/loader concern.)

> **Decision — exterior only (confirmed).** The demo ships the **exterior** map: **exclude** interior IPLs
> (`data/maps/interior/**`) from the placed-instance scan. So from `gta_int.img` we pull only the ~30 dff /
> ~15 txd interior-style props that appear in the _exterior_ IPLs; the bulk of the interiors is never included.

## Compression (fflate)

`fflate` is already in `node_modules` — **add it to `package.json` dependencies** (the LoaderManager unzips it
at runtime). Use a **zip** container (named entries → natural virtual FS; `unzip` → `{ name: bytes }`):

- Use **`zipSync`** (in-memory): fflate's _streaming_ `Zip` corrupted the archive on this data (unzip →
  "invalid distance"). Run with `NODE_OPTIONS=--max-old-space-size=12288` for the ~GB `models.zip`.
- Per-extension level: DEFLATE (level 6) for `.dff/.col/.ipl/.dat/.ide` (compress well); **STORE** (level 0)
  for `.txd` (DXT is already compressed — deflating wastes CPU for ~0 gain).

## Script + npm wiring

- `scripts/build-game.ts` (tsx) — `--game <name>` (required; resolves `game-src/<name>/`, errors if missing).
- `package.json`: `"build:game": "tsx scripts/build-game.ts"` + thin per-variant aliases
  `"build:original": "tsx scripts/build-game.ts --game original"` (add others as variants appear).

## Pure logic + tests (mandatory — see memory tests-mandatory)

Extract the decision logic so it's unit-testable without the giant imgs / fs / zip:

- `scripts/game-build/partition.ts` — pure:
  - `placedModels(iplInstanceIds, ideIdMap): { models, txds }` — placed ids → the unique referenced model +
    txd base names via the IDE id map.
  - `resolveSource(name, gta3Names: Set, gtaIntNames: Set): 'gta3' | 'gta_int' | null` — the
    gta3 → gta_int → drop fallback.
  - `partitionEntries(refs, gta3Names, gtaIntNames): { priority, models, textures }` of
    `Entry = { name; source: 'gta3' | 'gta_int' }` — col/ipl/ifp/dat (gta3) → priority; each `.dff` → models;
    each `.txd` → textures; referenced-but-in-neither dropped.
- `partition.test.ts` — negative (referenced-but-in-neither dropped; buckets disjoint by extension) then
  positive: only col/ipl/ifp/dat in priority (no dff/txd); every referenced dff in models, txd in textures;
  **a name missing from gta3 but present in gta_int resolves to `source:'gta_int'`** (the override case). Add
  `scripts/**/*.test.ts` to `vitest.config` `test.include`.
- The I/O shell (open both imgs via `openArchive`; parse IPLs/IDEs for the placed set; for each Entry pull bytes
  from its `source` img; zip via fflate; write `static/<version>/` + manifest) stays thin over the tested core.

## Verify

- `npm run build:original` → `static/original-<pkgVersion>/{priority,models,textures}.zip + manifest.json`;
  assert the three zips are pairwise disjoint, priority has **no** img dff/txd, models is all `.dff`, textures
  is all `.txd`, and the gta_int-sourced set is the expected few-dozen props (not the whole interior archive).
- `npm test` green (partition tests), tsc, eslint, no Cyrillic.

## Out of scope (next tasks)

- **LoaderManager** — unzip the three archives into an in-memory virtual FS, version-cache (IndexedDB/Cache
  API), and stage the load (priority on boot; models + textures on Start, in whatever order it chooses).
- Rewiring the engine/adapter to read assets from the loader's virtual FS instead of `fetch` + `loadArchive`
  on `static/`.

---

**Since-fixed (2026-06-19): the partition dropped all `tobj` models.** The build's IDE id→model map
(`ideRefs`, formerly inline `ideIdMap` using only `parseIde`) read `objs`/anim but **not `tobj`** — so
time-of-day models (lit-window / neon night overlays) were never packed into the models/textures chunks, and
every tobj object vanished in-game (runtime `resolveMap` lists them, but their DFFs weren't in the archive).
Night-vertex-color windows were unaffected (ordinary `objs` models). Fix: `ideRefs` now merges `parseIde` +
`parseTimedObjects`. Recovered ~143 models on original-extend (`nitelites_*`, `lanitewin*`, …). Needs a
rebuild (`npm run build:game:<game>`). Test in `scripts/game-build/partition.test.ts`.
