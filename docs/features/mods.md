# Game mods (WorldMod) + vegetation wind

`src/game/mods/` (`mod.interface.ts`, `wind.mod.ts`, `wind-mode.ts`), plans 039/040.

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
