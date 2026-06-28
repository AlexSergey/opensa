# ped-installer

Offline tool: drop **ped mod folders** onto a base GTA-SA game tree and produce a single drop-in `--out`. Each
ped's `dff`/`txd` replace the stock ones inside `gta3.img`; a **new** ped's line is merged into `data/peds.ide`.
Sibling of [`vehicle-installer`](../vehicle-installer/readme.md), but simpler (peds touch one data file).

```sh
tsx tools/ped-installer/src/cli.ts --game ./game-src/non-modified --in ./peds --out ./build [--strip]
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …).
- `--in` — folder of peds; each immediate subfolder is one ped (`<model>.dff` + `<model>.txd` [+ `*.settings.txt`]).
- `--out` — output install dir (wiped + rebuilt each run).
- `--strip` — optional (off by default): reduce `gta3.img` + `peds.ide` to **only** the installed peds (plus the
  player ped, so the engine still has someone to spawn).
- `--player <model>` — the player / main-character ped to keep when stripping (default `BMYPOL1`, the project's
  `GAME_CONFIG.mainCharacter`).

## How it works

- **Replace** (zero-config, the common case) — a folder's `<model>.dff`/`.txd` swap the stock ones in `gta3.img`;
  `peds.ide` is left untouched (the existing slot/id/type/anim group stay).
- **Add** — a new model (not in `peds.ide`) ships a `*.settings.txt` carrying its `peds` line; that line is merged
  into `peds.ide` (validated with the engine's `parsePedDefs`).

Out of scope (see the plans): animations (`ped.ifp`), `pedstats`/voice/audio, collision, and `pedgrp.dat`
population groups.

See [`docs/plans`](./docs/plans) for the design: [001 architecture](./docs/plans/001-architecture.md),
[002 add/replace peds](./docs/plans/002-add-replace-peds.md), [003 strip](./docs/plans/003-strip.md).
