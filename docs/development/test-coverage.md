# Test coverage

Run: `npm run test:coverage` (Vitest + v8). Scope (from `vitest.config.ts`): `src/**/*.ts` logic; **excluded**
`*.test.ts`, `index.ts`, `*.interface.ts`, `test-utils.ts`, `src/standalone/**`, all `.tsx` UI, and the
**GL / DOM / app-loop glue** (`game.ts`, `core/renderer`, `core/camera-controller`, `input/keyboard`, the
sky/water/postfx/ambient/directional/vehicle-reflection GL plugins, `vehicle-headlight.system`,
`setup-character`, `src/ui/**`) — WebGL/browser code verified on the Playwright e2e lane (`e2e.md`), not by
headless node units (same rationale as the `.tsx` exclusion). See plan 046 for the roadmap.

## Current (2026-06-13, after It.1–7 + coverage hardening)

**Statements 88.9% · Branches 78.64% · Functions 87.21% · Lines 88.81%** over the headless scope above
(108 test files, 651 passing, 0 skipped). Enforced floors in `vitest.config.ts`
(`coverage.thresholds`): statements/lines/functions **85**, branches **77** — a small buffer below the
achieved numbers so an unrelated change can't silently erode coverage (`npm run test:coverage` fails below).
Branches sit lower by nature (error/edge + fetch paths in `resolve-map`/`img-archive`/`build-region`).

## Baseline (2026-06-13, Iteration 0)

90 test files, 543 passing / 8 skipped. (Iteration 1 committed the missing real fixtures → **551 passing, 0
skipped**; the 8 were real-asset `skipIf` tests gated on absent `testground.*` / a packed `gta3.img`.
Iteration 2 de-coupled the text parsers from `static/` and filled the surfinfo/text-lines gaps →
**92 files, 558 passing, 0 skipped**. Iteration 3 covered the three untested three/ builders
(corona/night-fill/animated-objects) and added real-model tests (admiral/tommy/washer/water/junk/col) →
**95 files, 582 passing, 0 skipped**. Iteration 4 covered `procobj-categories.ts` and audited the
map/collision/streaming edge registry (all locked) → **96 files, 586 passing, 0 skipped**. Iteration 5
covered the game systems with extractable logic (weather-transition, vehicle-damage, vehicle-physics,
character-animation, wind-mode) → **101 files, 617 passing, 0 skipped**. Iteration 6 covered the non-GL
plugin/core logic (clock, system-registry, cloud-profile, render-pipeline, reflection presets, fog plugin) →
**107 files, 644 passing, 0 skipped**. Iteration 7 added an adapter integration test (real cell build via a
fixture-backed archive + real timecyc/character loads through stubbed fetch) → **108 files, 647 passing, 0
skipped**. Iteration 8 scaffolded the Playwright e2e lane (object-viewer smoke + visual baseline, 3 tests) —
separate from `npm test`; see `e2e.md`.)

| Metric | % | covered/total |
|---|---|---|
| Statements | 66.9 | 3782/5653 |
| Branches | 62.17 | 1351/2173 |
| Functions | 64.25 | 550/856 |
| Lines | 66.42 | 3650/5495 |

### Per area (statements %)
- **Strong (≥90):** `parsers/binary` 97, `parsers/text` 96, `three/` 91.5, `streaming/` 96, `collision/` 97,
  `events/` 100, `time/` 94.
- **Partial:** `map/` 81, `archive/` 77, `vehicle/` 60 (enter/lod high; damage/headlight/physics 0),
  `physics/` 52, `adapters/` 34, `character/` 30, `weather/` 32.
- **Zero / very low:** `game.ts` 0, `core/*` 0, `plugins/*` 0 (cloud-profile, presets, all plugin GL),
  `input/keyboard` 0, `three/corona` 18, `three/night-fill` 59, `three/build-col-wireframe` 67,
  `weather-transition` 0, `vehicle/{damage,headlight,physics}.system` 0, `character/{animation.system,setup}` 0.

## Untested-module triage (the 43 without a sibling test)

### Unit-testable now (pure / extractable logic) — target of Iterations 1–6
- Parsers/util: `parsers/text/surfinfo.parser.ts`, `parsers/text/text-lines.ts`, `parsers/binary/col-types.ts`,
  `parsers/binary/constants.ts`, `map/procobj-categories.ts`.
- three/: `three/corona.ts` (buildCoronaPoints), `three/night-fill.ts` (onBeforeCompile inject, like
  world-material), `three/animated-objects.ts` (update logic), `three/build-col-wireframe.ts` (raise to full).
- game logic: `weather/weather-transition.ts` (blend), `plugins/cloud-profile.ts` (weather→profile),
  `plugins/vehicle-reflection/presets.ts` (registry), `plugins/render-pipeline.ts` (ordering),
  `plugins/fog.plugin.ts` (distance→density pure bits), `vehicle/vehicle-damage.system.ts`,
  `vehicle/vehicle-part.ts`, `vehicle/vehicle-physics.system.ts` (math via physics mock),
  `character/character-animation.system.ts` (clip selection), `core/clock.ts`, `core/system.ts`,
  `ecs/world.ts`, `ecs/components.ts`, `events/events.global.ts`, `input/keyboard.ts` (mockable),
  `mods/wind-mode.ts`, `ui/locations.ts`.

### Viewer / e2e only (canvas / GL / DOM / full loop) — Iteration 8
- `game.ts` (whole loop), `core/camera-controller.ts`, `core/renderer.ts`, `input/keyboard.ts` (DOM — low value
  to mock), `plugins/{sky,water,postfx,ambient-light,directional-light}.plugin.ts`,
  `plugins/vehicle-reflection/vehicle-reflection.plugin.ts` (GL/shader output — extract pure bits in It.6,
  leave GL to e2e), `vehicle/vehicle-headlight.system.ts` (canvas textures — logic already covered in
  build-vehicle), `character/setup-character.ts` (model load — adapter integration in It.7),
  `ui/hud/load-fonts.ts`, `ui/debug/debug-styles.ts` (trivial styles), the three `standalone/*-viewer.ts`
  (these are the e2e harness, not units).

## Notes
- v8 counts `.ts` files loaded during the run plus the `include` glob, so zero-coverage files still appear.
- Coverage thresholds are intentionally NOT gated yet — measure first (this doc), set per-area floors in a
  later iteration (plan 046, It.7).
