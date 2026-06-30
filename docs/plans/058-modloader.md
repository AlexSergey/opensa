# 058 — modloader: architecture, complexity & task plan

**Plan only — no code yet.** A SA-MTA-style **modloader**: a game tree may contain a `modloader/` folder whose
subfolders ship replacement vehicle `dff`/`txd` (+ optional settings `.txt`). The mod assets **override** the
stock ones by name, and the settings are **merged** into the base `vehicles.ide` / `handling.cfg` / `carcols.dat`
before the engine reads them — **without touching the engine** (`packages/game`).

Scope (phase 1, done): **vehicles only**, settings = `vehicles.ide` line + `handling.cfg` line + `carcols.dat`
line. Duplicate-file conflict resolution is out of scope. **Phase 2 (planned, below): map/asset mods** — new
defs/placements/collision/`txdp` via a gta.dat-style loader file (loads our `lod-trees`/`lod-procobj` `--modloader`
output + community map mods). See "Extension (planned)".

## How the engine reads vehicles today (measured)

`GtaSaWorldAdapter` (`packages/game/src/adapters/gta-sa-world.adapter.ts`):

- **DFF/TXD** — `loadVehicle(model)` does `requireBuffer(fs, '<model>.dff')` (and the same for `.txd`). It reads
  the **bare** archive name (the key gta3.img / the raw install populate). There is no loose `vehicles/` folder —
  the roster comes from `vehicles.ide`. So serving a `<model>.dff` override under that **same bare key** shadows
  the stock model with zero ambiguity.
- **Settings** — `ensureVehicleData()` (lazy, on the first `loadVehicle`, then cached) reads three **text** files
  via the VFS and parses them:
  - `requireText(fs, 'data/vehicles.ide')` → `parseVehicleDefs` (keyed by **model name**, the `cars` section).
  - `requireText(fs, 'data/carcols.dat')` → `parseCarcols` (keyed by **model name**).
  - `requireText(fs, 'data/handling.cfg')` → `parseHandling` (keyed by **handling id**, uppercase).

So overriding a vehicle = (a) serve its `dff`/`txd` under the bare `<model>.*` key, and (b) make those three text
files, **as the VFS returns them**, contain the mod's line for that vehicle. The VFS is a flat, synchronous,
last-write-wins key→bytes store (`@opensa/vfs`) and `AssetFileSystem extends ImgArchive` — i.e. the thing the
engine reads through is just an interface we can **decorate**.

## The example (`./1`)

```
modloader/
  admiral - 1976 Mercedes-Benz 230 - k1real24/
    admiral.dff   admiral.txd   admiral.settings.txt
  alpha - …/   alpha.dff  alpha.txd  alpha1.txd … alpha4.txd  alpha.settings.txt
```

The folder layout is **irrelevant** — like the real Modloader, files may sit at the root of `modloader/` or be
nested any number of levels deep. `<name>.dff`/`.txd` match the stock gta3.img names (a mod may ship several
txds — each overrides by its own name). `*.settings.txt` bundles **three lines** (blank-line
separated), each from a different stock file:

```
416, 	ambulan, ambulan, car, AMBULAN, AMBULAN, van, ignore, 10, 0, 0, -1, 0.82, 0.82, -1   ← vehicles.ide cars line
AMBULAN  3500.0 14000.0 4.0 …                                                                ← handling.cfg line
ambulan, 1,3                                                                                  ← carcols.dat car line
```

The settings file may be **absent** (→ keep stock settings) or **partial** (only some of the three blocks).

## Design — a thin `AssetFileSystem` decorator (between VFS and the engine)

A new runtime package **`@opensa/modloader`** (`type:engine`), one entry point:

```ts
withModloader(vfs: AssetFileSystem): AssetFileSystem
```

It wraps the VFS so the engine reads through it transparently — **no change to `packages/game`**. Wiring is a
single line where the app hands the fs to the engine (`new Game({ fs: withModloader(vfs) })`).

At construction (eager, synchronous — the VFS is sync):

1. **Scan** `vfs.names` for any file under `modloader/` (at any depth — folders are ignored): every `.dff`/`.txd`
   and every `*.settings.txt`.
2. **Override map** — each `.dff`/`.txd` → its bytes, keyed by its **bare file name** (shadows gta3.img for
   `loadVehicle`, which reads the bare `<model>.dff` / `<txd>.txd`).
3. **Settings** — parse each `*.settings.txt`, split into blocks, **classify** each block by feeding it to the
   existing parsers (`parseVehicleDefs('cars\n…\nend')`, `parseHandling(…)`, `parseCarcols('car\n…\nend')`) — the
   one that parses cleanly tags the block. Collect per-vehicle `{ ideLine?, handlingLine?, carcolsLine? }`.
4. **Merged texts** — build override strings for `data/vehicles.ide` / `data/handling.cfg` / `data/carcols.dat`:
   take the base text and **replace** each overridden vehicle's line in place (by model / handling-id key,
   section-aware), inserting if absent. (Same section-aware line-edit discipline as the `lod-trees` IDE/IPL
   editors.) Only build a merged string for a file that an override actually touches.

Reads:

```ts
get(name)     → overrideBytes.get(name) ?? vfs.get(name)
getText(name) → mergedText.get(name)    ?? vfs.getText(name)   // the 3 vehicle data files
has / names   → union of the override keys with the VFS
```

Everything is precomputed once, so reads stay O(1) and synchronous (the engine's contract).

### Module shape

```
packages/modloader/src/
  index.ts          withModloader(vfs)
  scan.ts           scanModloader: walk modloader/** → { overrides: bare-name→bytes, settings: parsed[] }
  settings.ts       parse a .settings.txt → { ideLine?, handlingLine?, carcolsLine? } (classify via the parsers)
  merge-ide.ts      replace a cars-section line by model in vehicles.ide
  merge-handling.ts replace a line by handling-id in handling.cfg
  merge-carcols.ts  replace a car-section line by model in carcols.dat
```

Depends on `@opensa/renderware` (the three parsers + `AssetFileSystem`/`ImgArchive` types) and `@opensa/vfs` only
for the type. No engine, no loader code.

## Prerequisite — getting `modloader/` into the VFS (turned out **free**)

The decorator reads `modloader/**` from the VFS as loose entries — and **both loaders already ingest them**, no
change needed:

- **fetch build** — `scripts/build-game.ts` `walk(src)` walks the **whole** game tree, excluding only the model
  archives + `anim.img`, and buckets every other file by `looseGroup` (`.dff`→models, `.txd`→textures, `.txt`→
  others). So `modloader/**` is packed + keyed by its lowercased relative path.
- **local loader** — `selectInstallEntries` returns `loose: source.looseFiles()` = **all** loose files (anything
  not an `.img` archive), so `modloader/**` flows straight into the VFS.

So the only change outside the package is the **one-line app wiring**.

## Complexity estimate — **Medium, low-risk**

| Part                                                 | Effort      | Notes                                                                                 |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `withModloader` decorator + override map (dff/txd)   | **Low**     | sync wrap; `loadVehicle` reads the bare `<model>.dff`/`<txd>.txd` the overlay shadows |
| Scan `modloader/**` from the VFS                     | **Low**     | string ops over `vfs.names`                                                           |
| Parse + classify `.settings.txt` blocks              | **Low–Med** | reuse the 3 existing parsers to validate/classify; handle partial/absent              |
| Merge into vehicles.ide / handling.cfg / carcols.dat | **Med**     | 3 section-aware line-replace editors (same pattern as the lod-trees IDE/IPL editors)  |
| Ingest `modloader/**` into the VFS                   | **Low–Med** | small additions to `build-vfs.ts` + `build-game.ts` (loader/build, not engine)        |
| Wiring (`withModloader(vfs)` at the fs boundary)     | **Trivial** | one line in `apps/web`                                                                |
| Tests                                                | **Med**     | settings classify, the 3 merges, the decorator override + passthrough                 |

**No engine changes.** The only friction is the 3 text-merges (small, well-trodden) and the loader/build ingestion
of `modloader/`. Roughly a focused day or two.

## Task plan (phases)

1. **Scaffold** `@opensa/modloader` ✅ (package + symlink + nx `type:engine`; vitest/eslint via the `packages/**`
   globs — no special override, the package is pure browser TS).
2. **Settings parse/classify** ✅ — `settings.ts`: split blank-line blocks, structural guess + validate with the
   real parser; a handling line needs ≥ 20 fields (so prose isn't taken for handling). Tests on the `./1` example.
3. **Three merges** ✅ — `merge.ts`: `mergeIde` (cars section, model col 1) · `mergeCarcols` (car section, col 0) ·
   `mergeHandling` (flat car table, first token; comments/`!`/`$` sub-tables left alone). Replace-in-place, append
   new before `end`. Tested (replace, leave others, append).
4. **Decorator** ✅ — `index.ts` `withModloader(fs)` (+ `scan.ts` `scanModloader`): scan `modloader/**` (any depth),
   build the bare `<file>.dff|txd` override map + merged `vehicles.ide`/`handling.cfg`/`carcols.dat`; `get`/`getText`/
   `has`/`names` overlay, everything else passes through. Returns the same fs when there's no overlay. Tested.
5. **Ingestion + wiring** ✅ — ingestion was already free (both loaders pull `modloader/**` in as loose files).
   Wired `withModloader(vfs)` in `apps/web/.../use-asset-boot.ts`: once the VFS is loaded (`phase === 'warmup'`+),
   the returned `fs` is the modloader overlay (memoised once per loaded session, stable ref). No engine change.
6. **Verify** — _pending the user_: drop the `./1` modloader into a game tree, load, confirm the modded
   admiral/ambulan render with merged handling/colours.

## Open / out of scope

- Duplicate files across modloader subfolders (which wins) — **out of scope** (user-deferred); for now, last-scan
  or first-scan wins, undefined.
- **New** vehicles (not stock) — needs a free object id + full `cars`/handling/carcols rows; the examples are all
  stock overrides, so assume **override-only** (keep the stock id). New-vehicle id allocation is a later add.
- Non-vehicle objects, other settings (e.g. `vehicles.col`, mod-specific textures beyond the car txd) — later.
- Where exactly the app wraps the fs (`use-asset-boot` / `canvas-host`) — confirm the single call site.

---

# Extension — map/asset mods (`loader.txt` + IDE/IPL/COL/txdp)

**Status: ✅ Implemented (decorator); in-game verify pending.** Phase 2 of the decorator: load **map/asset mods** —
new object defs + placements + collision + `txdp` parents registered through a **gta.dat-style loader text file**,
not just vehicle dff/txd overrides. This is the "OpenSA next stage" that `lod-trees-generator` plan `008` and
`lod-procobj-generator` plan `004` defer to: it makes our own `--modloader` output (`lod/` + `hd/`) load in OpenSA,
and as a bonus loads community map mods of the same shape (MixMods "Project Props", "LOD Vegetation", "BSOR
Vegetation").

## Why this is mostly **free** in the engine (measured)

The map pipeline already reads everything **through the `fs`** — so the same `AssetFileSystem` decorator pattern
(overlay + merged text) covers it, with **no `packages/game` change**:

- **`resolveMap(fs)`** (`packages/renderware/src/map/resolve-map.ts`) reads `data/gta.dat` via `fs.getText`, then
  for each `IDE` line → `fs.getText(normalizeDatPath(path))` → `parseIde` (catalog) **+ `parseTxdParents` (txdp)**,
  and for each `IPL` line → `parseIpl` (text) **+ `loadBinaryStreams`** (bare `<base>_streamN.ipl` via `fs.get`).
- **`setTxdParents(defs.txdParents)`** is already wired in `GtaSaWorldAdapter.load` — so any `txdp` section in a
  loaded IDE takes effect (the `hd/` mod's `*_hd.ide`).
- **`buildCollisionIndex(fs)`** scans **every `.col` in `fs.names`** and keys models by name — collision is
  **auto-discovered**, so `COLFILE` lines are moot (exactly why our generators don't emit them; embedded/bare col
  just works once it's in `names` + `get`).

So the engine already turns "a richer `gta.dat` + files served by name" into catalog + placements + txdp +
collision. The whole job is in the decorator.

## What the decorator must add (on top of the vehicle overlay)

1. **Widen the override scan.** Today `scanModloader` collects `.dff`/`.txd` + `*.settings.txt`. Extend it to
   collect **all** mod asset files — `.ide`, `.ipl`, `.col`, and stock data overrides (`.dat`) — into the same
   **basename → bytes** index, and add them to `names` (so `buildCollisionIndex` sees the `.col`, `loadBinaryStreams`
   sees the streams, clump/txd loaders see the dff/txd).
2. **Detect loader files by _content_, not name.** Folder layout and the loader filename **vary** (`loader.txt`
   vs `Loader.txt`; nested under `lod/`, `hd/`, `Project Props 4/Custom Props/Props/…`). A file is a loader iff,
   after dropping `#` comments + prose lines, ≥ 1 line parses as a gta.dat directive (`IDE`/`IPL`/`COLFILE`). This
   cleanly **excludes** `readme.txt` (no directives) and the vehicle `*.settings.txt` (its lines start with a
   model/number, never `IDE`/`IPL`/`COLFILE`) — belt-and-braces, also skip `*.settings.txt` by name.
3. **Merge loader directives into `data/gta.dat`.** Collect the `IDE`/`IPL` lines from **every** loader file (a mod
   can ship several — `lod/loader.txt` + `hd/loader.txt`), append them to the base `gta.dat`, and serve that as the
   `getText('data/gta.dat')` override (same merged-text mechanism as the vehicle settings). `resolveMap` then loads
   the mod's new `lodtrees.ide` (defs), `lodtrees_hd.ide` (txdp), and `lod_procobj.ipl` (placements). **`COLFILE`
   lines are parsed** (`loader.ts`) but need no wiring — the `.col` is auto-discovered (see the `COLFILE` section).
4. **Resolve every IDE/IPL read by basename.** `resolveMap` reads IDE/IPL by their gta.dat path
   (`fs.getText('data/maps/lodtrees.ide')`, the stock `data/maps/<area>.ipl` override); `get`/`getText` must match
   the request's **basename** against the mod index (any depth, case-insensitive, spaces allowed — e.g.
   `Project Props - Trees.ipl`). This is exactly how real Modloader resolves files (bare name, on-disk path
   irrelevant) and how the modified **stock** text IPL / binary stream overrides shadow their originals (their
   basename equals the stock file's, already in stock `gta.dat`, so no loader line is needed for them).

That's the whole design: **overlay by basename + merged `gta.dat`**. No new map/parsing code in the engine.

## Mapping our generator output → this loader

| Generator output (`--modloader`)                             | How it loads in OpenSA                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lod/loader.txt` = `IDE data/maps/lodtrees.ide`              | merged into gta.dat → `resolveMap` loads `lodtrees.ide` (impostor defs) by basename                                                                            |
| `lod/data/maps/<area>.ipl` (modified stock text IPL)         | basename override of the stock IPL (already in gta.dat) → repointed `lod` rows                                                                                 |
| `lod/gta3img/<area>_streamN.ipl` (modified stream)           | `loadBinaryStreams` reads it by bare name → the HD `lod` repoint applies                                                                                       |
| `lod/gta3img/lodtrees.{dff,txd,col}`                         | dff/txd by name (clump/txd loaders); `.col` auto-discovered by `buildCollisionIndex`                                                                           |
| `hd/loader.txt` = `IDE data/maps/lodtrees_hd.ide`            | merged → `resolveMap` `parseTxdParents` → `setTxdParents` (stock TXD ← custom)                                                                                 |
| `hd/gta3img/<model>.dff` + custom `.txd`                     | served by bare name; the `txdp` parent makes the custom textures resolve                                                                                       |
| lod-procobj `lod/loader.txt` = `IDE … + IPL lod_procobj.ipl` | merged → new defs + the static scatter→IPL placements                                                                                                          |
| lod-procobj `lod/data/procobj.dat` (disable rows)            | **additively merged** onto stock — each converted `(surface,model)` rule replaced with `spacing=∞` ⇒ scatter disabled; stock species kept (see the strip note) |

## Caveats the design must respect (called out by the user + the examples)

- **Folder names vary / are meaningless** — `lod/`, `hd/`, `map/gta3.img/`, `files dff/`, `Project Props 4/Custom
Props/Props/…`. The scan walks the modloader subtree at **any depth**; nothing keys off a folder name.
- **Loader filename varies** — `loader.txt` / `Loader.txt` (and prose header lines like `bennet tank`, `LOD
Vegetation by …`). Content-based detection, case-insensitive, prose-tolerant.
- **Paths**: backslash or forward slash, any case, **spaces** (`DATA\MAPS\X.IDE`, `data/maps/Project Props - X.ipl`,
  `modloader\BSOR_Vegetation\thetxdp.ide`). Normalize like `normalizeDatPath` (backslash→slash, lowercase) and key
  by basename.
- **`readme.txt` and other non-loader `.txt`** must not be misread as loaders (the content check handles it).
- **Text encoding** — some mods ship a `Loader.txt`/data file as **UTF-16** (e.g. the SA Brightened Project's
  Notepad-saved `Loader.txt`), which a plain UTF-8 decode turns to garbage so its directives never register.
  Handled in `@opensa/vfs` `getText` (BOM-aware: UTF-16 LE/BE → the right decoder; a UTF-8 BOM is stripped; no BOM
  = UTF-8), which the modloader scan + the engine both read through.

## `COLFILE` + additive `.dat` merges (✅ implemented)

- **`COLFILE`** — `parseLoader` (`loader.ts`) now reads `COLFILE <level> <path>` (level dropped) alongside `IDE`/
  `IPL`, so a COLFILE-only loader is still recognised. It needs no extra wiring: the referenced `.col` ships under
  the mod tree, is bucketed into `assets` by extension, lands in `names`, and `buildCollisionIndex` **auto-discovers**
  it by model name. So `COLFILE` is honoured implicitly — the directive is parsed for completeness/future use.
- **Additive `.dat` merges** — `data-merge.ts` (`ADDITIVE_DAT` + `mergeDataFile`): `object.dat` (key = model) and
  `procobj.dat` (key = `surface+model`) are **line-merged** onto stock — a mod row **replaces** the stock row with
  the same key and new keys are appended, keeping every untouched stock row + comments. So a community mod that ships
  only its new procobj species (e.g. Project Props) keeps the base game's, and several mods stack. **procobj.dat
  replaces by key on purpose** — the engine parses it as a flat list, so an appended duplicate `(surface, model)`
  would scatter the species twice. `scan.ts` accumulates every mod copy per file (`dataMerges`); `index.ts` folds
  them onto `fs.getText('data/<file>')`.
- **`surfinfo.dat` / `plants.dat` stay whole-file overrides** (in `texts`) — `surfinfo.dat` is a **positional**
  table (index = COL material id), so appending would corrupt the indexing; line-merging them is unsafe.

> **`procobj.dat` strip interaction — resolved (disable rows).** Additive merge can't **remove** a stock species by
> omission, so `lod-procobj --modloader` no longer ships a _stripped_ `procobj.dat` (which the merge would undo,
> re-adding the species from stock → scattered _and_ statically placed = doubled). Instead it emits **disable rows**:
> each converted `(surface, model)` rule re-stated with `spacing = 1e999` (→ `Infinity` ⇒ the scatter's
> `area / spacing` is exactly 0 ⇒ deterministically zero placements). The additive merge replaces the stock rule by
> `(surface, model)`, so the species stops scattering while untouched stock species are kept. Implemented in
> `disableProcObj` (`@opensa/map-placement/procobj-strip`), wired via `convertProcObj({ disableScatter: modloader })`.

## Out of scope / open (this extension)

- **Cross-mod / mod-vs-mod conflict priority** — still out of scope (per the vehicle phase). Basename collisions are
  last/first-scan-wins, undefined.
- **gta.dat line ordering / dedup** — appended after stock lines; `resolveMap` is last-IDE-wins for the catalog, so
  new ids (ours are fresh) don't clash. Duplicate `IPL` lines are deduped on merge (`mergeGtaDat`).
- **CLEO `.cs` scripts — out of scope.** OpenSA has no CLEO runtime; a mod's `.cs` won't run (e.g. the SA
  Brightened Project's "Illuminated Vinewood Sign" — its static IPL placement loads, the scripted illumination
  doesn't). Not a modloader concern.

## Task plan (phases) — extension

1. **Widen scan. ✅** `scan.ts`: `ModloaderScan` now buckets `.dff`/`.txd`/`.col` + binary `_stream` IPLs into
   `assets` (bytes, by bare name) and `.ide`/text `.ipl`/`.dat` into `texts` (by bare name); loader files into
   `mapRefs`; `*.settings.txt` into `settings`.
2. **Loader detect + parse. ✅** `loader.ts` `parseLoader`: collects `IDE`/`IPL` (via `parseGtaDat`) + `COLFILE`
   paths; a `.txt` with none of them (readme/prose) contributes nothing, and `*.settings.txt` routes to vehicle
   settings. The `.col` is auto-discovered by `buildCollisionIndex`, so `COLFILE` needs no further wiring.
3. **Merge into `gta.dat`. ✅** `merge.ts` `mergeGtaDat`: append the collected `IDE`/`IPL` lines to the base
   `gta.dat` (dedup by normalized path); exposed via the `getText('data/gta.dat')` override in `index.ts`.
4. **Basename resolution. ✅** `index.ts` `withModloader`: `get` → `assets.get(baseName)` ?? passthrough; `getText`
   → merged-text ?? `texts.get(baseName)` ?? passthrough; `names` = `fs.names ∪ assets.keys()` (so
   `buildCollisionIndex` finds the `.col`). Ingestion + app wiring (`use-asset-boot.ts`) were already free from the
   vehicle phase — the call site is unchanged.
5. **COLFILE + additive `.dat` merges. ✅** `loader.ts` parses `COLFILE`; `data-merge.ts` (`ADDITIVE_DAT` +
   `mergeDataFile`) line-merges `object.dat`/`procobj.dat` (replace-by-key + append, keeping stock); `surfinfo.dat`/
   `plants.dat` stay whole-file overrides. `scan.ts` accumulates per-file copies (`dataMerges`); `index.ts` folds
   them onto stock. (See the procobj.dat strip-interaction note.)
6. **Verify (offline). ✅** `index.integration.test.ts`: a `lod/`+`hd/` map mod wrapped by `withModloader` → real
   `resolveMap` yields the new catalog id (`5000`), the `txdParents` (`mytreetxd → vegetation`), the text-IPL
   override instance, and the binary-stream `lod` repoint (`700` → `lod 0`). Unit tests cover scan bucketing,
   loader/COLFILE parsing (incl. `Loader.txt` + `readme.txt` negative), `mergeGtaDat`, the additive `.dat` merges,
   and the overlay reads. 37 tests pass, lint clean.
7. **In-game verify** (pending): load a game tree with the mods under `modloader/…`; confirm impostors attach at
   distance with no doubling, HD textures resolve via `txdp`, props place + collide.

## Relationship

- Consumes the output of `lod-trees-generator/008` (`lod/`+`hd/`) + `lod-procobj-generator/004` — the "OpenSA next
  stage" both defer to. Same `txdp` mechanism those use (`@opensa/map-placement/retxd` `txdpSwappedModels` →
  `parseTxdParents`/`setTxdParents` here). Reference mods: Project Props 4, LOD Vegetation, BSOR Vegetation, and the
  SA Brightened Project (the multi-mod bundle that surfaced the UTF-16 loader + `.ifp` gaps).

---

# Follow-up — `.ifp` (animation) override (✅ implemented)

**Status: ✅ implemented.** A `modloader/` mod can now override **animation packages** (`.ifp`) by name, like it
already overrides `.dff`/`.txd`/`.col`. Motivation: the SA Brightened Project ships zone-object animation
fixes — `cn2_ringking.ifp`, `des_stmotsigbas1.ifp` (animated map props: a rotating sign, etc.) — that previously
loaded nothing because the scan ignored `.ifp`.

## Why it's a one-line change (measured)

Both engine IFP read paths go **through the `fs` by name** — exactly the overlay pattern:

- **Zone-object clips** — `getIfp(archive, name)` (`packages/renderware/src/archive/asset-cache.ts`) does
  `archive.get('<name>.ifp')` by **bare name** (the IFP an IDE `anim` row references — this is what the SA
  Brightened Project's `cn2_ringking.ifp` etc. use).
- **Direct loads** — `GtaSaWorldAdapter.loadAnimations(ifpName)` does `requireBuffer(this.fs, ifpName)` =
  `fs.get(ifpName)` (e.g. `anim/ped.ifp`); the decorator resolves it by **basename**.

So both already read through the decorated `fs.get`. The only gap: `scanModloader` doesn't bucket `.ifp`. Adding
`.ifp` to the `assets` bucket (bytes, by bare name — the same line as `.dff`/`.txd`/`.col`/`_stream`) makes a mod's
`<name>.ifp` shadow the stock one (stock IFP live in `anim.img`; the loose override wins by name, just like
`.dff`/`.txd` shadow `gta3.img`). No engine change.

## Task plan

1. **Scan. ✅** `.ifp` added to the `assets` extension check in `scan.ts` `bucket()` (+ doc comments).
2. **Test. ✅** `scan.test.ts`: `.ifp` buckets into `assets` by bare name. `index.test.ts`: `withModloader` serves
   it by `get('x.ifp')` (getIfp's bare read) **and** `get('anim/x.ifp')` (loadAnimations' path read), and it's in
   `names`. Separately, the UTF-16 loader fix (`vfs.ts`) is covered by the real fixture
   `tests/custom/modloader/utf16-loader.txt` (the SA Brightened Project's UTF-16 `Loader.txt`).
3. **In-game verify** (pending): a mod's `<name>.ifp` animates the referenced zone object in the running game.

## Caveats

- The IFP only takes effect if something **references** it — a zone-object IDE `anim` row (mod-supplied) for
  `getIfp`, or an explicit `loadAnimations` call. The override serves the bytes; it doesn't invent the reference.
- Whether OpenSA **renders** a given zone-object animation (e.g. UV/rotation 2dfx) is a separate engine-capability
  question; this plan only covers serving the overridden `.ifp`.
