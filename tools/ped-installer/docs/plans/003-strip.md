# 003 — ped-installer: `--strip`

A `--strip` flag (off by default) that reduces the output to **only** the peds passed in `--in`, so the result is
a minimal self-contained pack of just those peds. Parallels `vehicle-installer`'s `--strip`, but trimming **two**
artifacts instead of six: `gta3.img` and `peds.ide`.

## What it does

After the normal install, when `--strip` is set, `stripOutput` rewrites the output:

- **`gta3.img`** — `delete` every entry that isn't a **kept** ped's `dff`/`txd` (the names `applyPed` returned),
  then rebuild.
- **`peds.ide`** — in the `peds` section keep only **kept** models (comma col 1); the section markers
  (`peds`/`end`), comments and blank lines stay.

"Kept" = the installed models **plus the player ped** (see below).

## Keep the player ped (shared infrastructure)

Stripping every non-installed ped would remove the **player model** the engine spawns
(`GAME_CONFIG`'s main character — currently a stock ped slot), breaking the build immediately. So the player ped's
**model** (and therefore its `peds.ide` line + its `gta3.img` dff/txd) is **always kept**, exactly as
`vehicle-installer`'s strip keeps the shared `col` palette / handling sub-tables that the kept cars reference.

- The kept-player model comes from a **`--player <model>` CLI flag** (default `BMYPOL1`, the project's
  `GAME_CONFIG.mainCharacter`). The tool is standalone and can't read `apps/web`'s config, so the value is passed
  in rather than imported. It's lowercased and added to the keep-set before stripping; its `gta3.img` `dff`/`txd`
  are resolved from the (post-merge) `peds.ide` so the **txd is kept even when named differently** from the model.
  If a `--in` ped _is_ the player model, nothing special happens — it's already kept.
- This is the **only** implicit keep; everything else must be in `--in`.

## Keys tracked

`applyPed` returns, per ped: the `gta3.img` entry names (lowercased `dff`/`txd`) and the **model** (the `dff`
basename → the `peds.ide` key). `install` unions these across all peds, adds the player model, and hands them to
`stripOutput`:

```
applyPed → { imgNames, model }
install  → keep = ⋃ models ∪ { mainCharacter };  imgNames = ⋃ imgNames ∪ player dff/txd
```

## Modules

```
tools/ped-installer/src/
  strip.ts      stripOutput + stripGta3Img(keepNames) / stripPeds(text, keepModels)
  apply-ped.ts  returns { imgNames, model } (the strip keys)
  install.ts    collects the keys; adds the player ped; runs stripOutput when options.strip
  cli.ts        --strip → install({ …, strip })
```

`stripPeds` mirrors `vehicle-installer`'s `stripIde`: keep a line if it's a comment, has no comma, or its model
(col 1) is in the keep-set — but scoped to inside the `peds` section (the section walk from `stripSections`), so
stray commas outside the section can't be mis-trimmed. CRLF/LF preserved.

## Out of scope (same as 002)

`pedgrp.dat` population trimming (file absent in `game-src`), animations, pedstats/voice. If a `--game` ever ships
`pedgrp.dat`, trimming it to kept models (group **lines** preserved, like `vehicle-installer`'s `cargrp`) is a
future iteration with its own note.

## Status ✅

Implemented + tested. `strip.ts` — `stripPeds` (section-aware `peds` filter, comments/markers/other-sections kept,
CRLF preserved) + `stripGta3Img` (keep-set delete) + `stripOutput` (installed models ∪ player; player dff/txd
resolved from `peds.ide`). Wired into `install()` behind `options.strip`, with `--player` on the CLI
(`DEFAULT_PLAYER = 'BMYPOL1'`). `strip.test.ts` covers each stripper; `install.e2e.test.ts` adds a `--strip` run
over the real `peds.ide` fixture — `peds.ide` reduces to the installed ped + the player, and `gta3.img` to their
`dff`/`txd` (an unrelated stock entry is dropped); `stripGta3Img` no-ops when the archive is missing. `tsc`/`eslint`/
tests green (ped-installer 26).
