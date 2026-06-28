# 002 — ped-installer: install flow + add / replace peds

**Implemented.** The behaviour of the tool (architecture is [001](./001-architecture.md)). Status at the bottom.

## Install flow

`cli.ts` → `install({ gamePath, inPath, outPath, strip })`:

1. **Guard + reset** — `guardOut` (refuse root / `--out` == or ⊃ `--game`/`--in`, as `vehicle-installer`); wipe
   `--out`, copy the `--game` tree in. `--out` is now the stock game.
2. **Each ped folder** of `--in` (immediate subdirs, sorted alphabetically — order only matters when two peds
   touch the same stock model; last wins): `applyPed(folder, out)`.
3. **Optional strip** — when `--strip`, run `stripOutput` over the collected keys (plan [003](./003-strip.md)).
4. **Report** — `N ped(s) → <out> (M img entries)` (+ ` [stripped to installed]`).

`applyPed(folder, out)`:

1. **Models → gta3.img** — `set` `<model>.dff` + `<model>.txd` into `out/models/gta3.img`, **replacing by name**
   (adding if new), then rebuild + write the archive. Model name = the `.dff` basename.
2. **peds.ide (only if a line is supplied)** — if `<model>.settings.txt` (or any `*.settings.txt`) carries a
   `peds` line, `mergePeds` it into `out/data/peds.ide`. **No settings file → pure replacement**: the dff/txd are
   swapped and `peds.ide` is untouched (the existing slot/id/type/anim group remain).
3. Returns `{ imgNames, model }` (the keys a `--strip` run keeps).

## Replace vs Add — what decides it

| Mode         | Trigger                                                 | `peds.ide` effect                                                        |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Replace**  | model name **already** in stock `peds.ide`, no settings | untouched (reuse the stock line as-is)                                   |
| **Replace+** | model already in `peds.ide`, settings present           | `mergePeds` **replaces** that line (e.g. changed `txd`, type, animGroup) |
| **Add**      | model **not** in `peds.ide`                             | `mergePeds` **appends** a new line — settings **required** (else warn)   |

`mergePeds` does both with one rule (mirrors `vehicle-installer`'s `mergeIde`/`replaceOrAppend`): inside the
`peds` section, **replace the line whose model (comma col 1) matches**; if none matches, **append before the
section `end`**. `peds.ide` is roughly id-ordered → no re-sort (as `vehicles.ide`).

## Settings file → one `peds` line

`*.settings.txt` is blank-line-separated **blocks**; we only recognise **one** kind here — a `peds` line —
classified by structure and **validated** with the real `parsePedDefs` parser (an unrecognised block is dropped).
Far simpler than the vehicle four-way split.

| Block | Shape                                                                     | Goes to                |
| ----- | ------------------------------------------------------------------------- | ---------------------- |
| peds  | comma, **leading numeric id**, ≥ 3 cols (`280, cesar, cesar, CIVMALE, …`) | `peds.ide` `peds` sect |

`settings.ts`: split into blocks, take the first line of a block; if it has a comma, a numeric leading cell, and
`parsePedDefs('peds\n<line>\nend').size > 0`, it's the `pedsLine`; else drop. Returns `{ pedsLine? }`.

## Ped id handling (Add)

The SA ped id range is bounded (`peds.ide` header: "see default.ide for id ranges"). When **adding**:

- **Trust the settings line's id** when present and free (no different model already on it) — keep it verbatim.
- If the settings id **collides** with a different existing model's id, the merge still keys off the **model name**
  (so it appends a new line); the duplicate id is reported as a warning (the game tolerates it poorly — the author
  should pick a free id). We do **not** silently renumber in this first iteration.
- **No settings line for a new model** → the ped's dff/txd still ship in `gta3.img`, but it isn't registered;
  emit a warning (`<model>: new ped with no peds line — not added to peds.ide`).

(Auto-assigning a free id from the range is a possible later refinement — noted under deferred.)

## Merge rule (the one file)

- **peds.ide** (`mergePeds`) — replace the `peds`-section line whose **model** (comma col 1) matches; append
  before the section `end` if absent. Comments / blank lines / the `peds`+`end` markers untouched. CRLF/LF
  preserved (detect from the base, as `vehicle-installer`).

## Deferred / out of scope (now)

Tagged so we pick them up later:

- **Animations** — a ped mod may need new clips (`anim/ped.ifp`) or a different `animGroup`; merging IFP / anim
  groups is out of scope (a later iteration in the engine's animation handling).
- **pedstats / voice / audio** — `pedstats.dat`, voice-archive / audio bank lines: not touched.
- **Collision** — peds use the shared generic ped COL; no per-ped COL handling.
- **Population groups** — `pedgrp.dat` (which ambient groups a ped spawns in) is **not present** in
  `game-src/non-modified/data`; an install does **not** add a ped to population yet (parallel to
  `vehicle-installer`'s deferred `cargrp` install-side). Needs its own plan if picked up.
- **Auto-id assignment** — picking a free ped id for a new model with no settings id.

## Task plan (phases)

1. **Scaffold** — `tools/ped-installer/` package (workspaces + symlink + vitest glob + eslint override + nx tag);
   `cli.ts` + `install.ts`/`guardOut` (mirror `vehicle-installer`).
2. **img-merge** — dff/txd into `gta3.img`. Unit: replace-by-name + new-entry add; returns lowercased names.
3. **settings classify** — `settings.ts` one-way classify + validate via `parsePedDefs`. Unit: a valid peds line,
   drop-unknown, no-comma/short line rejected.
4. **mergePeds** — replace in place; append in the `peds` section when absent; leave comments/other lines. Unit
   each, asserted through `parsePedDefs`.
5. **apply-ped + e2e** — full `install()` over fixtures: a ped's dff/txd land in `gta3.img`; a new ped's line lands
   in `peds.ide` (assert via `parseTxd` / `parsePedDefs`); pure-replacement leaves `peds.ide` byte-identical.
6. **Docs** — `readme.md`; cross-link from `docs/plans/README.md`; mark the deferred items.

## Status ✅

Implemented + tested. `cli.ts` / `install.ts` (`guardOut`) / `img-merge.ts` (`mergePedImg`) / `settings.ts`
(`parsePedSettings`) / `merge.ts` (`mergePeds`) / `apply-ped.ts` (`applyPed`). A `data/peds.ide` fixture was added
to `scripts/test-fixtures.ts` (`tests/original/`). Unit tests cover the img merge, the settings classify, and
`mergePeds`; `install.e2e.test.ts` runs the full `install()` over the real `peds.ide` fixture — a pure replacement
leaves `peds.ide` byte-identical, a settings line targeting an **existing** model replaces its line in place (no new
entry — the "Replace+" row), and a new ped's line is appended (all asserted via `parsePedDefs`). `tsc`/`eslint`/
tests green (ped-installer 26, incl. plan 003 strip).

The **id-collision warning** and **new-ped-without-a-line warning** from "Ped id handling" are noted but **not yet
emitted** — a small follow-up (the merge currently keys purely off the model name; a duplicate id or an unregistered
new model just goes through quietly).
