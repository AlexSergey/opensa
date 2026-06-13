# 024 — Distance fog

## Goal

GTA-SA-style distance fog that hides the far map (and the streaming/LOD edge + pop-in glitches) by
fading the world into the horizon colour. Requirements:

- Fog distance comes from **config** and there is a **method to change it at runtime**.
- A **slider in the debugger** (min 10, max 2000) to find the best distance in-game. (Now in the Atmosphere tab; was the "Game" section when written.)
- **Default 800.**
- **No fog in map-viewer mode** (you need to see the whole district there).

## Approach

three.js linear `Fog(color, near, far)` on `scene.fog`, plus `scene.background = FOG_COLOR` so the
fully-fogged distance reads as the horizon colour instead of empty black (there's no sky system yet —
roadmap item). "Fog distance" = the **far** plane (fully fogged); `near` is derived (`distance * 0.4`)
so it ramps in. The camera far plane (100000) stays — fog + background hide everything beyond.

A **`FogPlugin`** (mirrors `AmbientLightPlugin`/`DirectionalLightPlugin`): `install` creates the `Fog`,
sets `scene.fog` + `scene.background`, and applies the initial `config.fog.distance`. It reacts to
`Plugin.configChanged(config)` to (a) update the distance live and (b) **disable fog while
`config.mapViewer` is on** (`scene.fog = null`), restoring it on exit. Both runtime distance changes
and the map-viewer toggle already flow through `Game.setConfig` → `plugin.configChanged`, so the plugin
is the single place fog state is derived.

Distance is changed via a new `Game.setFogDistance(distance)` → `setConfig({ fog: { distance } })`.

## Config

`Config.fog: FogConfig` where `FogConfig = { distance: number }` (colour stays a plugin constant for
now; can move to config later). Default `{ distance: 800 }` in canvas-host; add to the 4 config test
fixtures.

## Status

DONE (iterations 1–3). `Config.fog: FogConfig{distance}` (default 800), `FogPlugin`
(`game/plugins/fog.plugin.ts`, linear `Fog` + `scene.background`, drops fog when `config.mapViewer`),
`Game.setFogDistance`, and the Game-section range slider (10–2000) via
`DebugActions.fogDistance()/setFogDistance()`. Fog colour is the `FOG_COLOR` const (0x9fb4c8) for now.

## Iterations

1. **Core fog.** Add `FogConfig` + `Config.fog` (+ canvas-host default 800 + test fixtures). New
   `game/plugins/fog.plugin.ts` (`FogPlugin`): `install` sets `scene.fog` (`Fog(FOG_COLOR, d*0.4, d)`)
   + `scene.background`; `configChanged` updates near/far from `config.fog.distance`. Register it in
   canvas-host. Add `Game.setFogDistance(distance)`. Result: fog renders, distance is config-driven and
   changeable at runtime.
2. **No fog in map-viewer.** `FogPlugin.configChanged` sets `scene.fog = null` when `config.mapViewer`,
   else the `Fog` instance — so entering/leaving the Map screen (which calls `setMapViewer`) toggles it.
   Verify enter/exit restores fog correctly.
3. **Debugger slider.** Extend `DebugActions` with `fogDistance(): number` + `setFogDistance(d)`
   (wired in canvas-host to `game.getConfig().fog.distance` / `game.setFogDistance`). In the **Game**
   screen add a range `<input>` (min 10, max 2000, step e.g. 10) showing the current value, driving
   `setFogDistance` live (alongside Show/Copy coords).

## Out of scope / later

- Fog colour from config / time-of-day (timecyc); sky/skybox (separate roadmap items — fog colour will
  later match the sky).
- Per-region fog. (`FogExp2` + the draw-distance coupling below are now done.)

## Follow-up (done): FogExp2 + draw-distance coupling + water fog

- **`FogExp2`** replaced the linear `Fog`: `density = FOG_K(2) / fog.distance` (≈63% fogged at
  0.5×distance, ~98% at the distance) — a haze that actually dissolves the far world. Fog colour now
  tracks the **timecyc sky horizon** each frame (`FogPlugin` `horizon` sampler = `skyBot`), and
  `scene.background` matches, so fully-fogged geometry blends into the sky dome.
- **Coupled to the LOD cull edge** (fixes "far objects not hidden"): the edge sits at
  `lodDrawDistance`; FogExp2 saturates (~99.8%) at `d ≈ 1.25 × fog.distance`, so it's hidden when
  `fog.distance ≤ lod × 0.8`. The debug **Draw Distance** slider sets `fog.distance = lod × 0.8`
  (`FOG_TO_LOD`) together with the LOD ring; the **Fog** slider is capped at `lod × 0.8` — it can only
  pull fog closer (thicker), never expose the edge.
- **Fog slider moved to the debug Map screen** (beside the draw-distance sliders — plan 009), out of
  the Atmosphere tab.
- **Water fog** (the custom water `ShaderMaterial` doesn't receive the scene `FogExp2`): `water.plugin.ts`
  applies fog itself — `uFogDensity` read each frame from `context.scene.fog`, fragment fades the
  colour → its horizon colour (= the fog colour) and alpha → 1 by the FogExp2 factor over camera
  distance. The far ocean now dissolves into the horizon like the terrain. Any future custom shader
  (e.g. glass) must likewise apply fog manually.
