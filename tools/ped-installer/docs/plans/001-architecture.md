# 001 — ped-installer: architecture

**Implemented** (install + `--strip`; see [002](./002-add-replace-peds.md) / [003](./003-strip.md)). A focused
offline tool: drop **ped mod folders** onto a base game and produce a
single drop-in `--out`. Each ped's `dff`/`txd` replace the stock ones **inside `gta3.img`**, and (when a new ped is
added) its `peds`-section line is merged into **`data/peds.ide`**. Sibling of `vehicle-installer`, but much
simpler: peds touch **one** data file (`peds.ide`) — no handling/carcols/carmods/palette.

```sh
tsx tools/ped-installer/src/cli.ts --game ./game-src/non-modified --in ./peds --out ./build
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …).
- `--in` — a folder of **peds**; each immediate subfolder is one ped (the descriptive folder name is ignored — the
  model name comes from the file basenames):
  ```
  peds/
    bfori - HD Black Female - someauthor/   bfori.dff  bfori.txd
    cesar - new gang ped - other/           cesar.dff  cesar.txd  cesar.settings.txt
  ```
- `--out` — output install dir (**wiped + rebuilt** each run).
- `--strip` — optional, **off by default**: reduce `gta3.img` + `peds.ide` to **only** the installed peds (plan
  [003](./003-strip.md)).

## What a ped mod ships (and the two modes)

Ped models live in `gta3.img` (verified: `bfori.dff/.txd`, `bmori`, `wmych`, … are all there) — same archive as
vehicles. A ped folder carries `<model>.dff` + `<model>.txd`, optionally a `*.settings.txt`. Two flows:

- **Replace** (zero-config, the dominant case) — the model name already exists in `peds.ide`; the mod just swaps
  the stock `dff`/`txd` in `gta3.img`. `peds.ide` is left untouched (the slot, id, type, anim group all stay).
- **Add** — the model is **new** (not in `peds.ide`); a `peds` line is required to register it. It comes from the
  ped's `*.settings.txt` (or is auto-assigned a free ped id). See plan [002](./002-add-replace-peds.md).

## Layering on the platform (what's reused vs new)

| Concern               | Reuse                                                                   | New                                                           |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| IMG read/write        | `@opensa/tool-kit/archive/img` (`openImg`/`createImg` → `set`/`build`)  | `img-merge.ts` (dff/txd → gta3.img)                           |
| Parse / validate peds | `@opensa/renderware` `parsePedDefs` (`packages/.../ped-defs.parser.ts`) | —                                                             |
| Settings classify     | the idea from `vehicle-installer`'s `settings.ts`                       | `settings.ts` (one **peds** block — far simpler)              |
| Section line-edit     | the `replaceOrAppend` shape from `vehicle-installer`'s `merge.ts`       | `merge.ts` (`mergePeds`: replace-by-model in the `peds` sect) |
| Orchestration / guard | `vehicle-installer`'s `install.ts`/`guardOut` shape                     | `install.ts`, `apply-ped.ts`, `cli.ts`                        |
| Strip                 | `vehicle-installer`'s `strip.ts` shape                                  | `strip.ts` (gta3.img + peds.ide only)                         |

`type:tool`, so it may depend on `type:engine` (renderware) and `type:tool` (tool-kit). No engine runtime, no map
packages. `img-merge` / `merge` / `settings` deliberately **parallel** `vehicle-installer` rather than importing it
(each tool keeps its own copies — the ped variants are simpler and diverge), exactly as `vehicle-installer` keeps
its own copies of modloader's mergers.

## Modules

```
tools/ped-installer/src/
  cli.ts        arg parsing (--game/--in/--out/--strip) + dir validation → install()
  install.ts    install(): guardOut, wipe+copy game→out, iterate ped folders, apply each, optional strip, report
  apply-ped.ts  one ped: img-merge its dff/txd into out gta3.img; if a settings peds line exists, merge into peds.ide
  img-merge.ts  set <model>.dff/.txd into out/models/gta3.img (replace by name); returns the entry names written
  settings.ts   parse <model>.settings.txt → { pedsLine? } (one block: a `peds`-section line, validated)
  merge.ts      mergePeds(text, line): replace the `peds` line by model (col 1); append before `end` if absent
  strip.ts      stripOutput + stripGta3Img/stripPeds (kept set = installed models + the player ped)
```

## Why no extra data files

A vehicle install edits four data files; a **ped** install edits at most **one** (`peds.ide`). The other
ped-adjacent data is **out of scope** (plan 002 lists them): animations (`anim/ped.ifp`), `pedstats.dat`, voice/
audio, collision (peds use the shared generic ped COL), and population groups (`pedgrp.dat` — **not present** in
`game-src/non-modified/data`, so nothing to trim). This keeps the tool to: **models → gta3.img** (+ an optional
**peds.ide** line for new peds).

## Fixtures (tests)

Follow the `tests/original/` convention (`scripts/test-fixtures.ts`, `npm run test:fixtures` — gitignored,
regenerated from `game-src/non-modified`): a fixture that **copies** `data/peds.ide` and **extracts** a stock ped
`dff`/`txd` (e.g. `bfori`) from `gta3.img`. Unit tests that touch real data use `describe.skipIf(!existsSync(...))`,
plus synthetic in-memory cases for `mergePeds` / `settings` / `strip` (deterministic, no fixtures needed). Assert
results through the engine `parsePedDefs` parser.

## Workspace plumbing (new package checklist)

Root `package.json` workspaces + `node_modules/@opensa/ped-installer` symlink; vitest include glob; the eslint
Node-globals/console override for `tools/*`; nx `type:tool` tag (folder-derived). `readme.md` + these plans;
cross-link from `docs/plans/README.md`. Mirror how `vehicle-installer` was scaffolded.
