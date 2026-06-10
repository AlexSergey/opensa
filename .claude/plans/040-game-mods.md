# 040 — Game mods architecture (+ the wind mod, the first one)

## STATUS: DONE (2026-06-10) — shipped together with plan 039 iteration 5

## Why

The source game setup layers community mods over vanilla SA (vegetation wind, Proper Fixes, PS2
trails, …). Porting them as scattered branches in the render core made the core grow GTA-mod
specifics. This plan introduced a **mod contract** so each such feature is a self-contained module
under `src/game/mods/`, installed explicitly by the host.

## Architecture

- **`src/game/mods/mod.interface.ts`** — `WorldMod`:
  - `name: string`;
  - `decoratePart?(def: IdeObjectDef, part: RenderPart)` — cell-build hook, called once per built
    part AFTER the vanilla treatment (results cached with the cell in the adapter's `cellCache`);
  - `update?({ hours, seconds })` — per-frame uniform driving.
- **Wiring (canvas-host)** — ONE mod object, TWO registrations:
  ```ts
  const windMod = createWindMod();
  game.installMod(windMod);                    // wires update() in as a System ('mod:wind')
  new GtaSaWorldAdapter({ ..., mods: [windMod] }); // adapter composes all decoratePart hooks
  ```
- **Render-core hook** — `BuildRegionOptions.decoratePart` in `build-region.ts` is the ONLY thing
  the core knows about mods; everything else lives in the mod.
- **Layering amendment** — `game/mods/**` is, with `game/adapters/**`, allowed to import renderware
  (mods are GTA-specific by nature: they patch world materials and read object defs). The engine
  core elsewhere stays renderware-free.

## The wind mod (`wind.mod.ts` + `wind-mode.ts`)

Vegetation sway, ported from the source community wind mod:

- **Trigger = data, not heuristics**: membership in `WIND_MODELS` (312 models — the mod's own
  coverage, source of truth `static/wind/*.dff`, regenerate via `scripts/gen-wind-list.ts`) or the
  SA IDE `IS_TREE`/`IS_PALM` bits. **Prelit alpha must NEVER be the trigger**: SA uses it for road
  blend edges (~229), `LTS*`/`nitelites*` overlays, piers — the first alpha-based attempt produced
  128 false positives (audit: `scripts/wind-coverage.ts`).
- **Weights from the assets**: wind-ADAPTED DFFs (in `static/img/gta3`) encode per-vertex sway
  weight in the day-prelit ALPHA — 255 = rigid trunk, lower = swaying canopy (cedar 0xAA ≈ 0.33,
  dead trees 0xDC ≈ 0.14; verified byte-level). `buildClumpParts` (renderware — neutral asset
  decoding) emits the `swayWeight` attribute (= (255 − a)/255) + `RenderPart.swayAlphaMin`.
- **Shader** (vertex inject, composes with the world material's `onBeforeCompile`):
  `transformed.xy += trig(uWindTime · speed + phase(instanceMatrix translation)) · amount`, where
  amount = `swayWeight × weightAmplitude` (adapted assets) or `max(z,0) × heightAmplitude`
  (fallback — also self-limits stray-flagged flat models). Runs BEFORE the world material's shadow
  projection so received shadows follow the canopy. Program variants: `…|sway-{tree|palm}-{mode}`.
- **Tuning** (`SWAY` in wind.mod.ts): tree = fast/small flutter, palm = slow/wide swing; 'palm'
  picked by IDE bit or `palm` in the listed name (tuning choice, not a trigger).
- **Per-frame**: `update()` writes `seconds` into the module-shared `uWindTime` uniform.

### Future (from plan 039 addendum)

Unadapted models that should sway (e.g. `vgsEflgs1_lvs` casino flags — all alphas 0xFF, no veg
bits, not in the list) are added by **authoring weights**: a future `scripts/adapt-wind.ts` that
writes prelit alphas by material/texture selection (cloth vs pole) and saves the adapted DFF into
`static/img/gta3` + appends the name to the list. Candidates surface in `wind-coverage.ts` output
(`vegasflag*` etc. — review before adding).

## Future mod candidates (same contract)

- **PS2 trails** (post-effect — would need an `installPass`-style hook on PostFxPlugin, an easy
  contract extension);
- **traffic-light cycling** (would own the corona sequencing and lift `SUPPRESS_LIGHT_MODELS`);
- **adapt-wind authored assets** (above).

## Testing pattern

A mod is unit-tested standalone (`wind.mod.test.ts`): fake def + a real `buildWorldMaterial` part,
assert program cache keys / injected GLSL / uniform driving — including NEGATIVE cases proving the
mod ignores what it must (unlisted models; prelit-alpha-only models like `vegasnroad*`). The core
hook has its own test in `build-region.test.ts` (called per part, post-treatment, def passed).
