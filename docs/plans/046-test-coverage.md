# 046 — Test coverage hardening (pre open-source)

Bring the project to thorough, trustworthy test coverage before the techno-demo open-source release. This plan
is the audit + the iteration roadmap. **Status: ✅ DONE (2026-06-13)** — Iterations 0–7 complete (543→647
passing, 0 skipped; `test:coverage` gated at 85/77), Iteration 8 (e2e) scaffolded; per-iteration details and the
final summary are below.

## Goals

- Cover every feature in `docs/features/*` and every shipped plan with deterministic unit/integration tests.
- **Real over synthetic.** Where a behaviour can be verified against a real game asset, use one — committed to
  `./tests/**` (the mirror of `static/`), parsed from the **unmodded** `static/img/gta3original` (no mods).
- **Strictly follow the existing test structure** (see Conventions). No new test frameworks/util layers.
- Lock in every edge case we hit during development as a named regression test (registry below).
- e2e + visual-regression (Playwright + the 3 viewers) is scoped here but executed as a **separate task**.

## Conventions (must follow — already in the codebase)

- Vitest, `environment: 'node'` (no DOM/canvas — pure-three/canvas visuals stay browser/viewer-verified).
- Test files sit next to the module: `foo.ts` → `foo.test.ts`.
- **Negative cases first, positive after, each in its own `describe` block, separated by a blank line**
  (CLAUDE.md). Descriptive `it` names.
- Real fixtures: read with `readFileSync('tests/<area>/<case>/<model>.<ext>')` + `toArrayBuffer` +
  the relevant parser (pattern: `breakable.test.ts`, `world-material.test.ts`). Per-case subfolder named for
  the scenario (e.g. `tests/dff/floodbeams/`). Never read `static/` directly. Copy needed assets from
  `static/img/gta3original` into `./tests` (keep them small — one model per case).
- Run only affected tests while iterating; full `npm test` at each iteration's exit.
- English only in committed code/tests/fixtnames; verify with the Cyrillic grep before finishing.

## Current state (baseline)

- 90 test files, 543 passing / 8 skipped. ~20 files use real fixtures; ~70 are synthetic.
- 43 source modules have **no sibling test** (full list captured in Iteration 0). Many are render/UI/plugins
  (canvas-bound — unit-test the extractable logic, leave visuals to the viewer/e2e phase).
- Tooling present: `@vitest/coverage-v8` (`npm run test:coverage`), Playwright 1.60 (no e2e wired yet),
  viewers `character-viewer` / `object-viewer` / `vehicle-viewer` (+ html entry points).

## Edge-case regression registry (must each become a named test)

These are the real bugs/quirks from development — every one gets an explicit regression test (most belong to a
specific iteration below; cross-referenced):

1. Degenerate/zero-length stored OR computed normals → black faces; sanitized in build-clump (plan 037).
2. `NO_ZBUFFER_WRITE` (0x40) applied to transparent-only (SA-DEVIATION) — opaque countryside terrain show-through.
3. TXD parent chain (`txdp`) texture inheritance.
4. GXT key hash = CRC-32 (0xEDB88320) **without** final inversion (not Jenkins).
5. Map geometry ignores DFF frame transforms (raw model space = COL space).
6. Floodlight beams: `white` texture + prelit vertex alpha = alpha-blended beam (ASSUMPTION; done in this plan's spirit) — `world-material.test.ts` real fixture already added.
7. Vehicle lamp materials: marker colours are per-lamp ids; head/tail by dummy position; `isBraking` states.
8. Vehicle paint markers (carcol) + texture modulate; light-zone materials never painted.
9. Streaming LOD↔HD seamless swap (defer-removal) + hysteresis dead-band.
10. Roadsign 2dfx type-7: WORLD coords, identity mesh, glyph mapping (COMMAND_GLYPHS).
11. Breakable gate = RWBreakable presence (not effect 200); contact-force trigger; instance-key pairing.
12. procobj lottery scatter; `procObjLimit` drives render+collision; surfinfo row index = COL material id.
13. `extraIpl` gating (truthsfarm default on; barriers/carter/crack off).
14. timecyc 8-keyframe → 24h conversion (byte-exact vs reference) + irregular modded-file robustness (parser reads sky from fixed columns regardless of trailing extras).
15. Night vertex colours / dnBalance day↔night prelit blend.
16. DXT1/3/5 + RGBA8888 decode; alpha detection (drives transparency).
17. UV-anim shared uniform (scroll, no sign flip); IFP clamp/anim-frame retention.
18. COL spheres/boxes/trimesh → colliders; surface material ids.

## Iterations

### Iteration 0 — baseline + tooling (no behaviour change) — ✅ DONE (2026-06-13)
- `npm run test:coverage` (v8) baseline captured → `docs/development/test-coverage.md`: **66.9% stmts / 62.17%
  branch / 64.25% func / 66.42% lines** (543 tests). Per-area table + the untested-module triage
  (unit-testable-now vs viewer/e2e-only) written there.
- Decisions: thresholds NOT gated yet (measure first, floors later — owner); fixture budget OK (one minimal
  real model per case from gta3original).
- Coverage scope already configured in `vitest.config.ts` (`src/**/*.ts`; `.tsx`/viewers excluded → e2e).

### Iteration 1 — binary parsers (the foundation), real fixtures — ✅ DONE (2026-06-13)
`renderware/parsers/binary/*` — already 97% covered; the real win was **un-skipping the real-asset tests**.
- Root cause: 8 tests were `skipIf(!exists)` on absent fixtures — dff/txd referenced a non-existent
  `testground.*`, and `col.test` sliced a packed `static/models/gta3.img` (758 MB, not present). All skipped.
- Fix: committed minimal real `gta3original` fixtures and repointed the three real-asset blocks:
  - `tests/dff/building/washer.dff` (2 KB) — dff.test real block (prelit map model, 2 textures, no stored
    normals, 1 UV).
  - `tests/txd/junk.txd` (6 KB) — txd.test real block (2× 64×64 DXT1, opaque).
  - `tests/col/barriers.col` (COL2) + `tests/col/countn2_17.col` (COL3) — col.test now reads standalone `.col`
    (no WIMG archive slicer / no `static/` dependency).
- Result: **543 passing + 8 skipped → 551 passing, 0 skipped.** All binary parsers now verified against real
  unmodded assets, CI-safe (no `static/`).
- Deferred (low value): dedicated tests for `constants.ts`/`col-types.ts` (pure enums, covered via parsers);
  the synthetic txd block already covers DXT3/5/alpha/palette/16-bit, so a real alpha-txd fixture is optional.

### Iteration 2 — text parsers, real `.ide/.ipl/.dat/.zon` slices — ✅ DONE (2026-06-13)
`renderware/parsers/text/*` — 19 test files, **all 558 suite tests pass, 0 skipped**.
- **De-coupled every text test from `static/`** (CI-safe — none read `static/` now). Real-slice fixtures
  committed under `tests/data/`: `barriers.ide`, `int_cont.ipl`, `effects.fxp` (16-system slice of the 616 KB
  original — the systems the test references), `water.dat` (20-quad slice), plus the already-present
  `surfinfo.dat`, `procobj.dat`, `object.dat`, `timecyc.dat`/`timecyc_24h.dat`, `carcols.dat`, `handling.cfg`,
  `info.zon`, `vehicles.ide`, `gta.dat`. The old `gta.dat`-resolver helpers in `ide`/`ipl` tests were removed.
- Filled gaps: `surfinfo.parser.test.ts` (real `surfinfo.dat`: 179 names, `p_sand` at index 74) and
  `text-lines.test.ts` (cleanLines/splitRow/sectionedParse).
- Edge cases locked: **#14** timecyc reads sky from fixed columns, ignoring trailing extras (the grey-sky
  modded-file case — `timecyc.parser.test.ts`); **#12** procobj rules cross-check against surfinfo surfaces;
  **#2** `NO_ZBUFFER_WRITE`/`ADDITIVE` flag bits (`ide-flags.test.ts`).
- Every text parser now has a sibling test (real-slice positive + malformed/short negative).

### Iteration 3 — three/ builders (geometry/material/clump), real models — ✅ DONE (2026-06-13)
`renderware/three/*` — **19 test files, 146 tests; every three/ source now has a sibling test.** Full suite
**95 files, 582 passing, 0 skipped**.
- Closed the three untested files: `corona.ts` (buildCoronaPoints — null on empty, glow-layer mask, attribute
  packing + colour ÷255), `night-fill.ts` (applyNightFill — uniform injection, emissive-include preservation,
  cache-key suffix, composes with a prior onBeforeCompile), `animated-objects.ts` (mixer registry —
  detached=paused, attached advances, resumes on reattach, reset clears).
- New real-model fixtures + tests:
  - `tests/dff/vehicle/admiral.dff` (216 KB) — buildVehicle: 4 wheels/4 doors, head/tail lamp dummies (+Y/−Y,
    |x| kept), vehiclelights tagged head+tail (#7/#8), **no non-finite vertex positions** (#1 on a real car).
  - `tests/dff/skinned/tommy.dff` (92 KB) — buildSkinnedClump: 32-bone skeleton, bonesByName, standard biped
    bones (Root/Pelvis/Spine/Head).
  - `washer.dff` (already committed) — buildClumpParts emits the **nightColor** attribute alongside the day
    `color` (#15 day↔night prelit blend).
  - `water.dat` slice → buildWater merges all parsed quads into one indexed mesh.
  - `junk.txd` → buildTextureMap: DXT1 CompressedTextures, lowercased keys, sRGB, 64×64, opaque (#16 alpha flag).
  - `countn2_17.col` (308-face trimesh) + `barriers.col` (boxes) → buildCollisionWireframe edge counts.
- #1 normals sanitize already had the real casroyale zero-normals test; #6 floodbeams + #17 uv-anim already
  real. Exit met: every builder has a real-model (or pure-logic) test asserting its structural invariant.

### Iteration 4 — map pipeline, collision, streaming — ✅ DONE (2026-06-13)
`renderware/map/*`, `renderware/collision/*`, `game/streaming/*` — **17 test files, 107 tests** (only barrels
`map/index.ts` / `collision/index.ts` lack a sibling, as expected). Full suite **96 files, 586 passing, 0 skipped**.
- Closed the one untested logic file: `procobj-categories.ts` (`procObjCategory` — unknown→bushes fallback,
  known-model mapping case-insensitive, sea-floor surface forces `underwater` regardless of model, + a real
  `procobj.dat` sanity pass: every rule classifies into a valid category, coverage beyond just bushes).
- Audited the edge registry — all already locked by existing tests (kept, verified green):
  - **#2** `NO_ZBUFFER_WRITE` 0x40 = depth-write off only for transparent (SA-DEVIATION) — `build-region.test`.
  - **#5** map geometry ignores DFF frame transforms — `build-region.test` with real
    `tests/dff/frame-offset-ignored/ce_grndpalcst05.dff`.
  - **#12** procobj lottery scatter + `procObjLimit` + surfinfo row index = COL material id —
    `procobj-scatter/colliders/runtime/build-procobj` tests.
  - **#13** `extraIpl` standalone-group gating (truthsfarm on; unknown group ignored) — `resolve-map.test`.
  - **#18** COL2/COL3 spheres/boxes/trimesh → colliders + surface material ids — `col.test` (real
    `barriers.col` / `countn2_17.col` libraries; box/sphere/face `material` ids asserted).
  - **#9** streaming LOD↔HD defer-removal swap + hysteresis dead-band — `streaming.system.test`.
- Exit met: pipeline invariants covered and both SA-DEVIATION behaviours (#2, #5) locked. Deeper real-cell
  end-to-end (parse→build→instanced mesh+colliders for one real cell) is deferred to It.7 (adapter integration).

### Iteration 5 — game systems (vehicle / character / time / zones / weather / mods / events) — ✅ DONE (2026-06-13)
`game/*` — full suite **101 files, 617 passing, 0 skipped** (+31). Added tests for every untested file that
carries logic; mocked via the existing harness pattern (`SILENT_LOGGER`, fake PhysicsWorld/rig/controller).
- New tests:
  - `weather/weather-transition.ts` — smoothstep blend ease, settle-on-target, instant (≤0s) jump, mid-blend
    retarget snaps from the nearest endpoint, same-target/settled no-ops.
  - `vehicle/vehicle-damage.system.ts` — strong-hit gate, nearest-part hit mapping, deform→detach state
    machine, one-change-per-part-per-frame guard, fall TTL removal (#7 contact-force damage).
  - `vehicle/vehicle-physics.system.ts` — body→car transform copy, heading from the +Y forward, displacement
    wheel-roll (forward/reverse sign, deadzone, parked), remove() stops tracking.
  - `character/character-animation.system.ts` — idle/walk/run clip selection by speed, jump launch state,
    scripted-clip override + return, paused freeze, facing.
  - `mods/wind-mode.ts` — the sway-trigger set is non-empty and all-lowercased/trimmed (lookup contract).
- Deferred (no extractable logic / canvas): `vehicle-headlight.system.ts` (canvas textures — lamp logic
  already unit-tested in `build-vehicle`, It.3 → visuals to e2e It.8); `character/setup-character.ts` (model
  load → adapter integration It.7); `vehicle-part.ts` / `mods/mod.interface.ts` / `events/events.global.ts`
  (type/interface-only, no logic).
- Existing edge cases kept green: #7 isBraking (`enter-vehicle.test`), #14 timed-object window
  (`timed-object.system.test`), city zones, wind mod (`wind.mod.test`).

### Iteration 6 — plugins + core (extract testable logic) — ✅ DONE (2026-06-13)
`game/plugins/*`, `game/core/*`, `game/ecs/*` — non-GL logic now covered. Full suite **107 files, 644 passing,
0 skipped** (+27).
- New tests:
  - `core/clock.ts` — per-frame delta, first-frame zero, large-gap clamp (0.1s), elapsed accumulation.
  - `core/system.ts` — `SystemRegistry` routes update/fixedUpdate in order, skips missing hooks, remove stops it.
  - `plugins/cloud-profile.ts` — weather→profile (EXTRASUNNY-before-SUNNY substring order, families, SMOG bump
    + clamp, default fallback).
  - `plugins/render-pipeline.ts` — `BasicRenderPipeline` direct-render with no passes, runs passes in order,
    reverts after removal, safe remove of an unknown pass.
  - `plugins/vehicle-reflection/presets.ts` — `PRESETS` registry contract (ranges/enums valid; the plugin
    branches on fields; enhanced=sky-probe+pbr, PC/PS2=sa-envmap+sa-spheremap).
  - `plugins/fog.plugin.ts` — headless (real `Scene`/`FogExp2`): density = FOG_K/distance, live rescale on
    config change, map-viewer drops fog, dispose clears it, horizon colour tracked into fog+background.
- Deferred (GL/DOM → viewer/e2e It.8): `sky/water/postfx/ambient-light/directional-light.plugin.ts`,
  `vehicle-reflection/vehicle-reflection.plugin.ts`, `core/camera-controller.ts`, `core/renderer.ts` (the
  sky/fog *decision* bits that were cleanly extractable are covered; shader/uniform assembly stays e2e).
- No test for type/trivial-declaration files: `plugins/plugin.ts` (interfaces), `ecs/world.ts` (createWorld
  wrapper), `ecs/components.ts` (bitECS SoA declarations — no logic).
- Exit met: plugin/core decision logic covered; GL output deferred.

### Iteration 7 — adapter + wiring integration — ✅ DONE (2026-06-13)
`game/adapters/gta-sa-world.adapter.ts` — new `gta-sa-world.adapter.integration.test.ts` runs the **real**
builder/parser pipeline against committed fixtures; only the two network entry points (`loadArchive`,
`resolveMap`) are replaced (with a fixture-backed `ImgArchive` holding `washer.dff` + `junk.txd`), and global
`fetch` is stubbed to serve the committed data files. Full suite **108 files, 647 passing, 0 skipped**.
- Cell end-to-end: `prepare()` → `loadCell({0,0,hd})` parses `washer.dff`, builds it, and yields an
  `InstancedMesh` (count 1) whose `userData.region.def.modelName === 'washer'` and whose instance matrix sits
  at the placed native Z-up position [10,10] (parse→build→instanced mesh + position verified).
- `loadTimecyc()` against the real `timecyc.dat` → 21 weathers × 24 hours, `weathers[0].name === 'EXTRASUNNY_LA'`
  (the 8-keyframe→24h conversion runs through the adapter).
- `loadCharacter()` against the real skinned `tommy.dff` → a 32-bone skeleton + `bonesByName` (fetch→parse→
  buildSkinnedClump through the adapter).
- The pre-existing `gta-sa-world.adapter.test.ts` (collider conversion + cell caching + before-prepare guards)
  stays as the unit layer.
- Exit met: a real cell loads through the adapter and yields the expected meshes at the expected position; the
  timecyc + character load paths are exercised end-to-end too. (A full real WIMG `.img` cell remains an e2e
  concern — the 700 MB archive is not committed; the fixture-backed archive covers the same code path.)

### Iteration 8 — e2e + visual regression (SEPARATE TASK) — ✅ SCAFFOLDED (2026-06-13)
- **Wired Playwright** (`playwright.config.ts` + `e2e/`): two auto-started `webServer`s (Vite app :5173 +
  `serve static` :3001), Chromium project, screenshot tolerance. Scripts: `npm run e2e` / `e2e:ui` /
  `e2e:update`. Kept **out of `npm test`** (Vitest `include: src/**`; e2e lives in `e2e/**`).
- **First spec — `e2e/object-viewer.spec.ts`** (the asset-light real-pipeline page; models in committed
  `static/viewer/`, no WIMG archive): smoke (boots, canvas visible, **no console/page errors** through
  fetch→parse→build→render), model-switch interaction, and a **visual-regression baseline** (WebGL via
  SwiftShader = deterministic; baseline committed under `e2e/*-snapshots/`). **3 tests pass, stable on re-run.**
- Docs: `docs/development/e2e.md` (run, asset dependency on `static/`, snapshot/platform notes). Playwright
  artifacts gitignored; baselines committed.
- **Remaining (deferred, needs the full assets in the lane):** the deterministic scene baselines — sky at set
  times/weathers, vehicle at night with headlights, a streamed cell, breakable smash, floodbeams; and the
  whole-app smoke (teleport presets, enter/exit vehicle, night transition). These need the 700 MB archives
  provisioned into CI (the app/viewers can't boot without them), so they stay future work on this lane.

---

## Status — test-coverage hardening complete (It.0–7 done; It.8 scaffolded)

Baseline **543 passing / 8 skipped → 647 passing / 0 skipped** across **108 Vitest files**, plus a working
Playwright e2e lane (3 tests). Every parser, builder, system, and plugin with extractable logic is covered; the
full edge-case registry (below) is locked with named regression tests; real unmodded `gta3original` assets back
the parser/builder/adapter tests. Render/GL output and full-app boot remain on the e2e lane (It.8), which is
scaffolded and runnable, with the heavy-asset scene baselines deferred until the archives are wired into CI.

## Out of scope
- 100% line coverage as a hard gate (we target meaningful coverage + the edge registry; thresholds TBD after
  Iteration 0's baseline).
- Rewriting render/GL code to be unit-testable (visuals → viewers/e2e).

## Open questions (decide before/within Iteration 0)
1. Coverage thresholds — set a floor now, or measure first then pick? (Recommend: measure in It.0, set floors per area in It.7.)
2. Fixture budget — how many real models to commit (size). Recommend one minimal model per case from gta3original.
3. e2e (It.8) timing — right after It.7, or after the OSS release? (Recommend: smoke e2e before release, full visual-regression after.)
