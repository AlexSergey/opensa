# Time of day, night content, light sources

`packages/game/src/time/`, `packages/renderware/src/three/corona.ts`, `night-fill.ts`, canvas-host wiring,
plans 026/032/034/038.

## Implemented

- **Game clock**: minutes since midnight, `secondsPerGameMinute`, pause freezes time; debug Time
  screen with presets; `clockNightFactor` fade windows (`night.litFade` dawn/dusk).
- **Timed objects (`tobj`)**: hour-window visibility via `TimedObjectSystem`
  (`userData.timed`, hidden until the current hour applies); night-window detection for the
  glowing lit-window overlays.
- **2dfx light coronas**: per-model lights collected per cell into one `Points` cloud
  (camera-facing sprites, distance fade, `night.coronaDrawDistance`), on `GLOW_LAYER` so SSAO's
  normal prepass never rasterizes them (flickering-squares fix). Traffic lights render their
  coronas too (all bulbs at once — signal cycling is a future item).
- **Night fill** for dynamic objects (plan 034): cheap shader fill + rim so the player/vehicles
  aren't black at night; scaled by sun-height night factor.
- **Vehicle headlights** (plan 033, ⚠️ **MVP — redo later**): night-gated for SEATED vehicles (generalizes to
  NPC traffic). The lamp glass self-illuminates (emissive: head warm-white, tail red dim/brake) + small coronas
  at the lamp dummies; bloom makes the halo. Lamps are identified by POSITION near the `headlights`/`taillights`
  dummies (the marker colours are per-lamp ids, not front/rear). **No road beam** (the world is unlit) — the
  proper redo projects the beam onto the road polys (SA `CShadows`-style). Tuning in `graphics.headlights`.
- Night sky: stars, moon (`coronamoon` sprite, size/elevation knobs), skylight hemisphere knob.

## Known gaps / candidates

- Traffic-light signal cycling (red/amber/green phases) — currently all bulbs' coronas light at once.
- Headlights: road beam on the asphalt (project onto road polys, SA `CShadows`-style) — the MVP has none.
- Corona occlusion (SA traces line-of-sight; ours draw through geometry at some angles).

## Test coverage anchors

`hour-window` tests, `timed-object.system` tests, corona build tests. Headlights: `build-vehicle` (lamp
dummies + `lightType` by dummy position), `enter-vehicle` (`isBraking`); the system's visuals are
browser-verified (canvas/three, no `node` test env).
