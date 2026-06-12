# Time of day, night content, light sources

`src/game/time/`, `src/renderware/three/corona.ts`, `night-fill.ts`, canvas-host wiring,
plans 026/032/034/038.

## Implemented

- **Game clock**: minutes since midnight, `secondsPerGameMinute`, pause freezes time; debug Time
  screen with presets; `clockNightFactor` fade windows (`night.litFade` dawn/dusk).
- **Timed objects (`tobj`)**: hour-window visibility via `TimedObjectSystem`
  (`userData.timed`, hidden until the current hour applies); night-window detection for the
  glowing lit-window overlays.
- **2dfx light coronas**: per-model lights collected per cell into one `Points` cloud
  (camera-facing sprites, distance fade, `night.coronaDrawDistance`), on `GLOW_LAYER` so SSAO's
  normal prepass never rasterizes them (flickering-squares fix). Traffic-light models are
  temporarily suppressed (`SUPPRESS_LIGHT_MODELS`) until signal cycling exists.
- **Night fill** for dynamic objects (plan 034): cheap shader fill + rim so the player/vehicles
  aren't black at night; scaled by sun-height night factor.
- **Vehicle headlights v1** (plan 033): night-gated spotlight beams + lamp glow for SEATED
  vehicles (generalizes to NPC traffic); tuning in `graphics.headlights`. Known-rough; a rework
  via the DFF 2dfx vehicle lights is the planned v2.
- Night sky: stars, moon (`coronamoon` sprite, size/elevation knobs), skylight hemisphere knob.

## Known gaps / candidates

- Traffic-light cycling (red/amber/green phases) — biggest pending item; unblocks removing
  `SUPPRESS_LIGHT_MODELS`.
- Headlights v2 via vehicle 2dfx light entries.
- Corona occlusion (SA traces line-of-sight; ours draw through geometry at some angles).

## Test coverage anchors

`hour-window` tests, `timed-object.system` tests, corona build tests, headlight system tests.
