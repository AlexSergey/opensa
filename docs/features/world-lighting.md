# World lighting (SA prelit pipeline)

`packages/renderware/src/three/world-material.ts`, `build-clump.ts` (attributes),
`packages/game/src/plugins/postfx.plugin.ts`, canvas-host `coronas` system (uniform driver), plan 038.

## Implemented

- The static map renders **unlit**, the way SA's `CCustomBuildingDNPipeline` does:
  `texture × mix(day prelit, night prelit, dnBalance) × world tint`. Vertex normals stay in the
  geometry only for SSAO's normal prepass.
- `dnBalanceUniform` — the SA DNBalance, driven by the wall-clock lit fade (same window as lit
  windows / night tonemap).
- Two tint families (avoid double-darkening):
  - `worldTintUniform` — models WITHOUT night prelit (LODs): sun-arc day tint → dark timecyc
    ambient at night (`lodNightAmbScale`).
  - `worldDayTintUniform` — models WITH night prelit: same day arc, relaxing to
    `nightPrelitBrightness` at night (their night set IS the night look).
- Day arc follows sun height (white noon → warm dim dawn/dusk via `WORLD_DAWN_HUE`).
- **Manual shadow receive**: the unlit world samples the sun's dynamic-casters-only shadow map
  itself (4-tap PCF, instanceMatrix-aware), `autoUpdate` gate against stale maps, (1−night)²
  fade kills mile-long horizon shadows; `?shadowdebug=1` paints the term red. Only dynamics
  cast (SHADOW_SIZE ring); map meshes neither cast nor use renderer shadows.
- Night-lit timed overlays glow additively (`applyWorldWindowGlow`, `night.windowGlow` knob).
- Program variants compose via `customProgramCacheKey`: `saWorld`, `|night`, `|windowGlow`,
  `|uvAnim`, wind sway variants.
- PostFX: god rays, bloom, **ACES tone mapping (always on by design since plan 038)**, SSAO
  (glow Points excluded from its normal prepass via `GLOW_LAYER`).
- Calibration knobs in `graphics.worldLight` + debug → Atmosphere sliders.
- Degenerate-normal repair (black-face fix) for stored and computed normals.

## Known gaps / candidates

- Dynamic objects (player/vehicles) keep the lit path + night fill — no prelit for them (by
  design).
- `graphics.toneMapping` toggle still exists though the intended state is always-on (its
  interface comment is stale — says "off by default").
- Per-object ambient calibration for dynamics (plan 038 leftover note).

## Test coverage anchors

`world-material.test.ts` (variants, tint wiring, glow order, shadow uniforms),
`build-clump.test.ts` (attributes, normals repair), `build-region.test.ts` (treatments).
