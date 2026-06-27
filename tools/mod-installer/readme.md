# @opensa/mod-installer

Layer GTA-SA **mod folders** onto a base game into a single drop-in `--out`. Copy the game, then apply each mod on
top in alphabetical order — plain files overwrite, `gta3img/` loose entries merge into `gta3.img`.

```sh
tsx tools/mod-installer/src/cli.ts --game ./game-src/non-modified --in ./mods --out ./build
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …)
- `--in` — folder of mods; each immediate subfolder is a mod, mirroring the game tree:
  ```
  mods/
    a-trees/   { data/  models/  gta3img/ }   # gta3img/ = loose IMG entries
    b-roads/   { data/ }
  ```
- `--out` — output install dir (**wiped + rebuilt** each run)

## How it applies

1. `--out` is wiped, then the `--game` tree is copied in (the base).
2. Mod subfolders of `--in` are sorted **plain alphabetical** (`mod1`, `mod10`, `mod2` — not numeric-aware) and
   applied in order; a later mod wins on a conflict.
3. Per mod: copy **every** top-level entry except `gta3img/` over `--out` (overlay — overwrites matching files,
   keeps the rest); then merge the mod's `gta3img/` loose files into `--out/models/gta3.img` (add or replace by
   name), so they land on whichever `gta3.img` the mod ships or the inherited one.

It's the inverse of the LOD tools' `--loose` output (a `gta3img/` drop) — mod-installer **applies** such drops.

A guard refuses to wipe a dangerous `--out` (the filesystem root, or a path that is/contains `--game` / `--in`).
