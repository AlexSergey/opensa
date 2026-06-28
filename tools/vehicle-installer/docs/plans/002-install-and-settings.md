# 002 — vehicle-installer: install flow + settings merge

**Plan only — implement after.** The behaviour of the tool (architecture is [001](./001-architecture.md)).

## Install flow

`cli.ts` → `install({ gamePath, inPath, outPath })`:

1. **Guard + reset** — `guardOut` (refuse root / `--out` == or ⊃ `--game`/`--in`, as mod-installer); wipe `--out`,
   copy the `--game` tree in. `--out` is now the stock game.
2. **Each vehicle folder** of `--in` (immediate subdirs, sorted alphabetically — order only matters when two
   vehicles touch the same stock model; last wins): `applyVehicle(folder, out)`.
3. **Report** — `N vehicle(s) → <out>`.

`applyVehicle(folder, out)`:

1. **Models → gta3.img** — `set` `<model>.dff` + `<model>.txd` (+ any extra `<model>N.txd`, see below) into
   `out/models/gta3.img`, **replacing by name**, then rebuild + write the archive. Model name = the `.dff`
   basename.
2. **Settings** — if `<model>.settings.txt` (or any `*.settings.txt`) exists, parse it and run the four merges over
   `out/data/{vehicles.ide,handling.cfg,carcols.dat,carmods.dat}`.

## Settings file → four lines

`*.settings.txt` is blank-line-separated **blocks**; each block is **classified by structure** and **validated**
with the real parser (an unrecognised block is dropped). Four kinds (the first three as modloader, plus carmods):

| Block    | Shape                                                                     | Goes to                    |
| -------- | ------------------------------------------------------------------------- | -------------------------- |
| ide      | comma, **leading numeric id** (`602, alpha, alpha, car, …`)               | `vehicles.ide` `cars`      |
| handling | space-separated, ≥ ~20 fields (`ALPHA 1722.0 …`)                          | `handling.cfg`             |
| carcols  | comma, leading **name**, rest **numeric** (`alpha, 0,102, 79,25, …`)      | `carcols.dat` `car`/`car4` |
| carmods  | comma, leading **name**, rest **part ids** (`alpha, nto_b_l, nto_b_s, …`) | `carmods.dat` `mods`       |

The carcols vs carmods split (both are `name, …`): **all-numeric remainder → carcols; otherwise → carmods**
(validated by `parseCarcols` / `parseCarmods`). Any block may be absent.

## Merge rules per file

- **vehicles.ide** (`merge-ide`) — replace the `cars`-section line whose **model** (col 1) matches; append before
  the section `end` if absent. (id-ordered file → no re-sort.)
- **handling.cfg** (`merge-handling`) — replace the line whose **handling id** (first token) matches; append if
  absent. (Comments / `!`/`$` sub-tables untouched.)
- **carcols.dat** (`merge-carcols`) — **colour-count-driven section + alpha-sorted, can move sections**:
  1. Decide the section **from the vehicle's own settings line** (not a base lookup): combos are separated by a
     comma+whitespace, values within a combo by a bare comma, so **2 values/combo (`34,34`) → `car`**, **4
     values/combo (`1,31,1,0`) → `car4`**. (Total value count can't decide it — `alpha`'s 2-colour line has 16
     values, divisible by 4; the per-combo grouping is the reliable signal.)
  2. **Remove the model from BOTH `car` and `car4`**, then insert its line into the target section and **re-sort
     that section by model name**. So a vehicle that changed its colour count **moves**: a now-4-colour car leaves
     `car` for `car4`, and a now-2-colour car leaves `car4` for `car` — exactly per the settings it ships.
- **carmods.dat** (`merge-carmods`) — replace/insert the model's line in the **`mods`** section, then re-sort that
  section's lines by model name (stock `mods` is alpha-sorted: `admiral, alpha, banshee, …`). `link`/`wheel`
  sections untouched.

## Deferred / out of scope (now)

Tagged so we pick them up later:

- **LEFTOVER (loading) — extra numbered txds.** A vehicle may ship `<model>1.txd`, `<model>2.txd`, … (e.g.
  `alpha1`–`alpha4`, `bloodra1`). We **do** place them into `gta3.img` (so they ship), but **making the engine use
  them** (they are alternate paintjob/variant texture dictionaries) is **out of scope** — a later iteration in the
  engine's vehicle texture/paintjob handling.
- **LEFTOVER (engine) — carmods.** `parseCarmods` is added to renderware **now** (so the tool can merge the
  `mods` line and so the data is parseable), but it is **not wired into the engine** — the in-game vehicle
  **component/upgrade** system (mod shop parts, `link`/`wheel` rules) is a future iteration. No adapter usage yet.
- **`gta_int.img`** — vehicle models live in `gta3.img`; no `gta_int` path.

## Task plan (phases)

1. **Scaffold** — `tools/vehicle-installer/` package (workspaces + symlink + vitest glob + eslint override + nx
   tag); `cli.ts` + `install.ts`/`guardOut` (mirror mod-installer).
2. **`parseCarmods`** (engine) — `packages/renderware/src/parsers/text/carmods.parser.ts` + test on the real
   `carmods.dat` fixture. Update renderware docs (parser exists; engine wiring deferred).
3. **img-merge** — dff/txd (+ extra txds) into `gta3.img`. Unit: replace-by-name + the extra-txd inclusion.
4. **settings classify** — `settings.ts` four-way classify + validate. Unit: each block, the carcols/carmods split,
   drop-unknown.
5. **mergers** — `merge-ide`/`merge-handling` (replace-or-append) + `merge-carcols` (car/car4 + sort) +
   `merge-carmods` (mods + sort). Unit each: replace in place, add in alpha order, leave other lines/sections.
6. **apply-vehicle + e2e** — full `install()` over fixtures: a vehicle's dff/txd land in `gta3.img`, the four data
   files gain the merged/sorted lines; assert via the parsers (`parseTxd`/`parseVehicleDefs`/`parseHandling`/
   `parseCarcols`/`parseCarmods`).
7. **Docs** — `readme.md`; cross-link from `docs/plans/README.md`; mark the deferred items.
