# 004 — vehicle-installer: `--strip`

A `--strip` flag (off by default) that reduces the output to **only** the vehicles passed in `--in`, so the result
is a minimal self-contained pack of just those cars.

## What it does

After the normal install, when `--strip` is set, `stripOutput` rewrites the output:

- **`gta3.img`** — `delete` every entry that isn't an installed vehicle's `dff`/`txd` (the names `mergeVehicleImg`
  returned), then rebuild.
- **`vehicles.ide`** — keep only `cars` lines whose model (comma col 1) is installed; markers/comments kept.
- **`handling.cfg`** — keep only the **main car table** lines (letter-leading) whose id (first token) is installed;
  comments + `!`/`$`/`%` sub-tables kept.
- **`carcols.dat`** — in `car`/`car4` keep only installed models (col 0); the **`col` palette** stays (the cars
  reference its indices).
- **`carmods.dat`** — in `mods` keep only installed models; `link`/`wheel` stay.
- **`data/cargrp.dat`** — each population-group line keeps only its installed models; the group **lines** are kept
  (line order = ped-type index), so a group with no installed car is emptied rather than removed.
- **`parked.json`** — keep only the installed models' parked-vehicle entries (other fields preserved).

`cargrp.dat` also gets a new engine parser (`parseCarGroups` in `@opensa/renderware`, fixture + test), added for
this strip — the in-game population/traffic feature is a later iteration (no engine usage yet, tagged deferred).

## TODO — cargrp proper handling (future)

`cargrp.dat` is currently **strip-only** (filter to installed) + **parsed** (deferred in the engine). Not done yet:

1. **Install-side** — let a vehicle's `*.settings.txt` declare which **population group(s)** it belongs to, so an
   install _adds_ the car to those `cargrp.dat` groups (it then spawns in traffic) instead of only trimming. The
   strip's "emptied group line" behaviour (a group with no installed car becomes a comment-only line) is a stop-gap
   that this would supersede.
2. **Engine-side** — wire the population/traffic car selection to read `cargrp.dat` (the `parseCarGroups` output).

This needs its own plan when picked up.

## Keys tracked

`applyVehicle` returns, per vehicle: the `gta3.img` entry names, the **model** (the `dff` basename → ide/carcols/
carmods key), and the **handling id** (the ide line's col 4, else the handling line's first token, else the model,
uppercased → handling.cfg key). `install` unions these across all vehicles and hands them to `stripOutput`.

## Why keep the shared sections

The `col` palette, carmods `link`/`wheel`, and handling sub-tables are **shared infrastructure** the installed
cars reference (palette indices, part links, boat/bike handling) — stripping them would break the kept cars. Only
**per-car** entries are removed.

## Modules

```
tools/vehicle-installer/src/
  strip.ts        stripOutput + stripGta3Img/stripIde/stripHandling/stripCarcols/stripCarmods
  apply-vehicle.ts  returns { imgNames, model, handlingId } (the strip keys)
  install.ts      collects the keys; runs stripOutput when options.strip
  cli.ts          --strip → install({ …, strip })
```

## Status ✅

Implemented + tested: `strip.test.ts` (each stripper via the engine parsers + a gta3.img keep-set test) and an
`install.e2e` `--strip` run over the real data fixtures (gta3.img → only the installed dff/txd; the four data files
→ only the installed car, palette/wheel sections retained). `tsc`/`eslint`/tests green (vehicle-installer 37).
