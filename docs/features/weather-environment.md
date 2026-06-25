# Weather + environment (sky, water, fog)

`packages/game/src/plugins/sky.plugin.ts`, `water.plugin.ts`, `fog.plugin.ts`, `cloud-profile.ts`,
`packages/game/src/weather/`, `packages/renderware/src/parsers/text/timecyc*`, `build-water.ts`, plans
014/024/028/029/031.

## Implemented

- **timecyc**: vanilla 8-keyframe parsing + 24h conversion, or a shipped `timecyc_24h.dat`
  used as-is; per-weather per-hour colours (sky top/bottom, ambient, sun, fog…), blended
  sampling (`sampleTimecycBlend`). Colours are 0–255 **sRGB** — uniforms decode with
  colour management (managed=true) or the night sky washes grey.
- **Weather manager**: per-city weather sets (`weatherForCity`), region-crossing keeps the
  current weather but follows the new region's set; smooth transitions
  (`weatherTransitionSeconds`); debug Weather screen (rain/storm excluded by design).
- **Sky plugin**: gradient dome from timecyc, sun disc + god-rays source, procedural clouds
  (coverage/opacity profiles), stars, moon; night factor exported to every consumer
  (tints/shadows/fill).
- **Water**: `water.dat` quads + infinite ocean ring at sea level; shader with reflection, sun
  glint, darkness knobs; shoreline handled by the quads' alpha. The custom water shader applies the
  scene fog itself (the map's `FogExp2` doesn't reach a raw ShaderMaterial) — fades the far ocean into
  the horizon colour by the live `scene.fog` density, so it dissolves like the terrain.
- **Fog**: distance fog blended into the sky horizon colour (FogPlugin reads the timecyc sky
  bottom), `fog.distance` knob. Slider lives in the **debug Map screen**, coupled to draw distance
  (`fog ≈ lod × 0.8`) so the LOD cull edge stays hidden — see zones-hud-debug.

## Known gaps / candidates

- Rain/storm/sandstorm weathers intentionally not selectable (no precipitation effects yet).
- Underwater rendering state (timecyc has it; we don't switch).
- Water is visual-only (no swimming physics/buoyancy).

## Test coverage anchors

`timecyc` parser/convert/sample tests, `weather-zones` tests, `build-water` tests.
