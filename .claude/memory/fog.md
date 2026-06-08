---
name: fog
description: Distance fog (plan 024) — FogPlugin, Config.fog.distance, Game.setFogDistance, debugger slider
metadata:
  type: project
---

Plan 024 (`.claude/plans/024-fog.md`), DONE. GTA-style distance fog hiding the far map + streaming/LOD edge.

- `Config.fog: FogConfig { distance: number }` — default **800** (canvas-host) + the 4 config test fixtures.
- `FogPlugin` (`src/game/plugins/fog.plugin.ts`, registered in canvas-host like the light plugins):
  **exponential** `THREE.FogExp2(FOG_COLOR, density)` with `density = FOG_K(2) / config.fog.distance` on
  `scene.fog` (user preferred this over linear `Fog` — linear only *tinted* the mid-distance; exp2 actually
  dissolves the far world: ~63% fogged at 0.5×distance, ~90% at 0.75×, ~98% at distance), and
  `scene.background = FOG_COLOR`
  (0x9fb4c8) so the fully-fogged distance reads as horizon, not black (no sky system yet). Reacts to
  `Plugin.configChanged` to update the range live AND set `scene.fog = null` while `config.mapViewer` is
  on (no fog in the map inspector) — works because `setMapViewer`/`setFogDistance` both go through
  `Game.setConfig` → `configChanged`.
- `Game.setFogDistance(distance)` → `setConfig({ fog: { distance } })` (runtime change).
- Debugger Game screen: range slider 10–2000 (step 10) via `DebugActions.fogDistance()/setFogDistance()`.

Camera far plane (100000) untouched. Fog colour now tracks the sky horizon (skyBot) each frame via a `horizon` sampler (plan 029) — fully-fogged geometry blends into the sky dome; lodDrawDistance pulled to ~fog.distance so far geometry is culled, not ghosted. Related: [[world-streaming-plan]] (fade), [[in-game-debugger]].

**Open issue (deferred 2026-06-08):** with the gradient sky dome, far geometry fully fogged to `skyBot` can
still read as faint **blue silhouettes** where it sits against the brighter `skyTop` part of the sky (the old
flat `scene.background == fog colour` made it vanish perfectly). Tried widening the sky's low haze band
(`pow(vHeight,1.8)` in the dome shader) to converge fog/sky near the horizon — **reverted** for now (kept the
`smoothstep` sky). Real fix later: wider skyBot band and/or a harder fog wall so nothing shows through at the
slider distance. (FogExp2 itself was kept — user preferred it.)
