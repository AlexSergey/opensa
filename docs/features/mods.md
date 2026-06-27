# Game mods: drop-in `modloader/` overlay + WorldMod + vegetation wind

Two complementary mechanisms:

- **`modloader/` overlay** (`@opensa/modloader`, plan 058) — drop-in **asset/data** overrides (à la SA's Modloader):
  swap a vehicle's model/texture and tweak its `vehicles.ide`/`handling.cfg`/`carcols.dat` lines **without
  rebuilding**. Pure data, no code.
- **WorldMod** (`packages/game/src/mods/`, plans 039/040) — **code-level** engine features layered over the
  vanilla pipeline (the wind mod is the reference impl).

## Drop-in asset overlay (`modloader/`)

`packages/modloader/` (`scan.ts`, `settings.ts`, `merge.ts`, `index.ts`) — a thin `AssetFileSystem` **decorator**,
`withModloader(fs)`, wrapped around the VFS in `apps/web/.../use-asset-boot.ts` once assets are loaded. The engine
reads through it transparently — **no change to `packages/game`**. Returns the same fs untouched when there's no
`modloader/` tree.

- **Layout is irrelevant.** Drop files anywhere under `modloader/` — at its root or nested any number of folders
  deep (the descriptive folder names real packs use, e.g. `admiral - 1976 Mercedes-Benz 230 - k1real24/`, are
  ignored). Mirrors how SA's Modloader works.
- **Asset override = by bare file name.** Every `.dff`/`.txd` under `modloader/` shadows the same-named stock asset
  the vehicle loader reads from gta3.img (`loadVehicle` reads the bare `<model>.dff` / `<txd>.txd`, the names coming
  from `vehicles.ide`). So `admiral.dff` replaces the stock admiral; a mod shipping several txds (`alpha.txd`,
  `alpha1.txd` …) overrides each by its own name. Last write wins on a name clash.
- **Settings merge.** Each `*.settings.txt` is blank-line-separated **blocks**; each block is auto-classified by
  structure (comma + leading numeric id → `vehicles.ide` cars line; comma + name → `carcols.dat` car line; else a
  `handling.cfg` line) and **validated** with the real engine parser, so an unrecognised block is silently dropped.
  Recognised lines are merged into `data/vehicles.ide` / `data/handling.cfg` / `data/carcols.dat`: replace the
  matching entry in place (by model / handling id), append a brand-new one before `end`, leave every other line
  untouched. A settings file is optional, and may carry only some of the three lines.
- **Ingestion is free.** Both asset loaders (fetch + local raw install) already pull `modloader/**` into the VFS as
  loose files, so nothing else is needed to ship a pack.

```
modloader/
  admiral - 1976 Mercedes-Benz 230 - k1real24/
    admiral.dff   admiral.txd   admiral.settings.txt
  alpha - …/   alpha.dff  alpha.txd  alpha1.txd … alpha4.txd  alpha.settings.txt
```

```
445, admiral, admiral, car, ADMIRAL, ADMIRAL, null, normal, 4, 0, 0, -1, 0.70, 0.70, 0   ← vehicles.ide cars line
ADMIRAL  1400.0 3650.0 1.6 …                                                              ← handling.cfg line
admiral, 0,102, 79,25, 51,104                                                             ← carcols.dat car line
```

Test anchors: `scan.test.ts` (root/nested/multi-txd discovery), `settings.test.ts` (block classify + drop),
`merge.test.ts` (replace/append/leave-others), `index.test.ts` (bare-name override + the three merges + passthrough).

## Game mods (WorldMod) + vegetation wind

`packages/game/src/mods/` (`mod.interface.ts`, `wind.mod.ts`, `wind-mode.ts`), plans 039/040.

## Implemented

- **WorldMod contract**: `{ name, decoratePart?(def, part), update?({hours, seconds}) }` —
  self-contained features layered over the vanilla pipeline the way community mods layer over
  SA. `game.installMod(mod)` wires the per-frame update; the adapter's composed `decoratePart`
  runs during cell builds (after the vanilla IDE-flag treatment). `game/mods/**` and
  `game/adapters/**` are the only game layers allowed to import renderware (ESLint-enforced).
- **Wind mod** (`createWindMod`):
  - Trigger = the explicit `WIND_MODELS` list (312 names, generated from the ground-truth
    `static/wind/` folder) or IDE IS_TREE/IS_PALM flags. Prelit ALPHA is NEVER a trigger (it
    false-positived 128 non-vegetation models — roads, LTS overlays, piers); it only provides
    per-vertex sway WEIGHTS (255 = rigid trunk, lower = swaying canopy).
  - Two sway profiles (palm vs tree: height-based and weight-based modes), shared
    `uWindTime` uniform, shader-injection composing with the world material
    (`|sway-{kind}-{mode}` program variants).
  - Applies to instanced map parts AND procobj clutter (same decoratePart hook).

## Known gaps / candidates

- Wind backlog: 3 cacti models missing adapted weights; `vgsEflgs1_lvs` casino flags +
  `vegasflag*` candidates not adapted (authoring task — `adapt-wind` tooling planned).
- Future mods on this pattern: PS2 trails, traffic-light cycling.

## Test coverage anchors

`wind.mod.test.ts` (trigger negatives incl. alpha-only, weight/height modes, update),
`build-region.test.ts` decoratePart ordering, `gen-wind-list`/`wind-coverage` scripts.
