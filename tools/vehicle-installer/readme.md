# @opensa/vehicle-installer

Install GTA-SA **vehicle mod folders** onto a base game into a single drop-in `--out`. Each vehicle's `dff`/`txd`
go into `gta3.img` (replace by name), and its `*.settings.txt` lines are merged into the four data files.

```sh
tsx tools/vehicle-installer/src/cli.ts --game ./game-src/non-modified --in ./1 --out ./build
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …)
- `--in` — folder of vehicles; each immediate subfolder is one vehicle (descriptive name ignored — the model name
  is the file basename):
  ```
  1/
    alpha - 1994 Dodge Stealth RT - mad_driver/   alpha.dff  alpha.txd  alpha1.txd … alpha4.txd  alpha.settings.txt
    ambulan - 1982 Ford E-350 - 533/              ambulan.dff  ambulan.txd  ambulan.settings.txt
  ```
- `--out` — output install dir (**wiped + rebuilt** each run)
- `--strip` — _(optional, off by default)_ reduce the output to **only** the installed vehicles (see below)

## How it applies

1. `--out` is wiped, then the `--game` tree is copied in (the base). A guard refuses a dangerous `--out` (root, or
   a path that is/contains `--game`/`--in`).
2. Each vehicle folder (alphabetical) → **`applyVehicle`**:
   - **Models** — `set` every `.dff` + `.txd` (incl. extra numbered `<model>N.txd`) into `out/models/gta3.img`,
     replacing by name; rebuild the archive.
   - **Settings** — parse `*.settings.txt` (blank-line-separated blocks, each classified + validated by the real
     engine parser) and merge into:

| Block                              | Goes to                      | Rule                                                |
| ---------------------------------- | ---------------------------- | --------------------------------------------------- |
| `id, model, txd, …`                | `vehicles.ide` `cars`        | replace by model, else append before `end`          |
| `MODEL mass …`                     | `handling.cfg`               | replace by id, else append                          |
| `model, p,s, …` (numeric / `newN`) | `carcols.dat` `car` / `car4` | replace/insert; **may move** car↔car4; alpha-sorted |
| `model, part, … ` (part ids)       | `carmods.dat` `mods`         | replace/insert; section kept **alpha-sorted**       |
| `R,G,B  # newN …` (multi-line)     | `carcols.dat` `col`          | **custom colours** appended; see below              |

**`car` vs `car4`** is read from the vehicle's **own** carcols line — the colour count per combo (combos split on
`comma+space`, values within a combo on a bare comma): **2 values → `car`**, **4 values → `car4`**. The model is
removed from **both** sections and inserted into the target, so a vehicle whose mod changed its colour count
**moves** (a now-4-colour car leaves `car` for `car4`; a now-2-colour car leaves `car4` for `car`).

**Custom colours.** A vehicle can define new paint colours its carcols line references by name (`new1`, `new2`):

```
233,199,40   # new1 yellow taxi cab   yellow
186,208,125  # new2 light green cab   green

cabbie, 6,0,6,0, new2,0,new2,0, new1,0,new1,0
```

On install each `newN` is assigned the next free colour id — its position in the `col` palette (the stock palette
has 127 entries, ids 0–126, so `new1 → 127`, `new2 → 128`). The colours are appended to the `col` section (with the
id written into the `# 127` comment) and the carcols line's refs are resolved to those ids. **Many vehicles
accumulate**: ids continue from the current palette size, so the next vehicle's `new1` becomes 129, and so on.

## `--strip`

With `--strip`, after installing, the output is reduced to **only** the vehicles passed in `--in`:

- **`gta3.img`** — keeps only the installed vehicles' `dff`/`txd` entries (every other model dropped).
- **`vehicles.ide`** / **`handling.cfg`** / **`carcols.dat`** / **`carmods.dat`** — keep only the installed
  vehicles' lines (by model name; handling by id). Shared/structural sections are preserved: the carcols `col`
  palette (the cars reference it), carmods `link`/`wheel`, handling sub-tables (`!`/`$`/`%`), and comments.
- **`data/cargrp.dat`** — each population group line keeps only its installed models; the group **lines** stay
  (their order is the ped-type index), so a group with no installed car is left emptied.
- **`parked.json`** — keeps only the installed models' parked-vehicle entries.

The result is a minimal, self-contained pack of just the installed cars. Off by default (the full game is kept).

## Deferred (later iterations)

- **Extra numbered txds** (`<model>1.txd`, …) ship in `gta3.img`, but **using** them in-game (alternate
  paintjob/variant dictionaries) is out of scope.
- **carmods in-game.** The `parseCarmods` parser is added to the engine (`@opensa/renderware`) so the tool can
  merge the `mods` line, but wiring the in-game vehicle **component/upgrade** system onto it is a later iteration —
  no engine/adapter usage yet.
- **TODO — cargrp proper handling.** Today `cargrp.dat` is only **stripped** (filter to installed) and **parsed**
  (`parseCarGroups`, deferred in the engine). Still to do later: (1) let a vehicle's settings declare which
  **population group(s)** it joins, so installs _add_ the car to `cargrp.dat` (and it spawns in traffic), not just
  trim it; (2) wire the engine population/traffic system to read `cargrp.dat`. Needs a separate plan when picked up.

See [docs/plans/](./docs/plans/) (`001` architecture · `002` install + settings · `003` custom palette · `004`
strip).
