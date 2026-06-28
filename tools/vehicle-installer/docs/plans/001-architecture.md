# 001 — vehicle-installer: architecture

**Plan only — no code yet.** A focused offline tool: drop **vehicle mod folders** onto a base game and produce a
single drop-in `--out`. Each vehicle's `dff`/`txd` replace the stock ones **inside `gta3.img`**, and its
`*.settings.txt` lines are merged into the four data files (`handling.cfg`, `vehicles.ide`, `carcols.dat`,
`carmods.dat`). Sibling of `mod-installer` but vehicle-specialised (carcols `car`/`car4` routing, alpha-sorted
sections, a new `carmods` line).

```sh
tsx tools/vehicle-installer/src/cli.ts --game ./game-src/non-modified --in ./1 --out ./build
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …).
- `--in` — a folder of **vehicles**; each immediate subfolder is one vehicle (the descriptive folder name is
  ignored — the model name comes from the file basenames):
  ```
  1/
    alpha - 1994 Dodge Stealth RT - mad_driver/   alpha.dff  alpha.txd  alpha1.txd … alpha4.txd  alpha.settings.txt
    ambulan - 1982 Ford E-350 - 533/              ambulan.dff  ambulan.txd  ambulan.settings.txt
  ```
- `--out` — output install dir (**wiped + rebuilt** each run).

## Layering on the platform (what's reused vs new)

| Concern               | Reuse                                                                    | New                                                                                     |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| IMG read/write        | `@opensa/tool-kit/archive/img` (`openImg`/`createImg` → `set`/`build`)   | `img-merge.ts` (dff/txd → gta3.img)                                                     |
| Parse stock data      | `@opensa/renderware` `parseHandling`, `parseVehicleDefs`, `parseCarcols` | **`parseCarmods`** (engine, see below)                                                  |
| Settings classify     | the idea from modloader's `settings.ts`                                  | `settings.ts` (adds the **carmods** block)                                              |
| Section line-edit     | —                                                                        | `merge-*.ts` (ide/handling replace-or-append; carcols/carmods alpha-sorted, car4-aware) |
| Orchestration / guard | the shape of mod-installer's `install.ts`/`guardOut`                     | `install.ts`, `apply-vehicle.ts`, `cli.ts`                                              |

`type:tool`, so it may depend on `type:engine` (renderware) and `type:tool` (tool-kit). No engine runtime, no map
packages.

## Modules

```
tools/vehicle-installer/src/
  cli.ts          arg parsing (--game/--in/--out) + dir validation → install()
  install.ts      install(): wipe+copy game→out, guardOut, iterate vehicle folders, apply each, report
  apply-vehicle.ts one vehicle: img-merge its dff/txd(+extra txds) into out gta3.img, then run the 4 settings merges
  img-merge.ts    set <model>.dff/.txd (+ <model>N.txd) into out/models/gta3.img (replace by name)
  settings.ts     parse <model>.settings.txt → { ideLine?, handlingLine?, carcolsLine?, carmodsLine? } (classify + validate)
  merge-ide.ts      replace the cars line by model in vehicles.ide (append before end if absent)
  merge-handling.ts replace the line by handling-id in handling.cfg (append if absent)
  merge-carcols.ts  replace/insert in car or car4 (by base section), section kept alpha-sorted
  merge-carmods.ts  replace/insert in the mods section, kept alpha-sorted
```

(ide/handling/carcols mergers parallel modloader's `merge.ts`, but carcols here is **section-aware + sorted** and
carmods is new — so vehicle-installer keeps its own copies rather than importing the engine package.)

## Engine change — `parseCarmods` (deferred wiring)

`carmods.dat` has three sections: `link` (paired part ids), `mods` (`model, part, part, …` — the upgrade parts a
car accepts), `wheel` (wheel part ids). A new **`packages/renderware/src/parsers/text/carmods.parser.ts`**
(`parseCarmods`) parses all three (mirroring `carcols.parser.ts`'s section walk), keyed for the `mods` section by
model name. It is added **for the tool's use now** and to be wired into the engine's vehicle component system
**later** — see [002 — deferred work](./002-install-and-settings.md#deferred-out-of-scope-now). Tagged
`LEFTOVER (engine)`: no adapter/runtime usage yet.

## Fixtures (tests)

Follow the `tests/original/` convention (`scripts/test-fixtures.ts`, `npm run test:fixtures` — gitignored,
regenerated from `game-src/non-modified`): add fixtures that **copy** `data/{handling.cfg,vehicles.ide,
carcols.dat,carmods.dat}` and **extract** a stock vehicle `dff`/`txd` (e.g. `admiral`) from `gta3.img`. Unit tests
that touch real data use `describe.skipIf(!existsSync(...))` (as `build-vehicle.test.ts` does), plus synthetic
in-memory cases for the mergers (deterministic, no fixtures needed). The engine `parseCarmods` test uses the real
`carmods.dat` fixture.

## Workspace plumbing (new package checklist)

Root `package.json` workspaces + `node_modules/@opensa/vehicle-installer` symlink; vitest include glob; the eslint
Node-globals/console override for `tools/*`; nx `type:tool` tag (folder-derived). `readme.md` + these plans. Mirror
how `mod-installer` was scaffolded.
