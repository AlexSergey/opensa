# 058 — modloader: architecture, complexity & task plan

**Plan only — no code yet.** A SA-MTA-style **modloader**: a game tree may contain a `modloader/` folder whose
subfolders ship replacement vehicle `dff`/`txd` (+ optional settings `.txt`). The mod assets **override** the
stock ones by name, and the settings are **merged** into the base `vehicles.ide` / `handling.cfg` / `carcols.dat`
before the engine reads them — **without touching the engine** (`packages/game`).

Scope (now): **vehicles only**, settings = `vehicles.ide` line + `handling.cfg` line + `carcols.dat` line. Other
object types / settings, and duplicate-file conflict resolution, are **out of scope**.

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
