---
name: fog
description: Distance fog (plan 024) — FogPlugin, Config.fog.distance, Game.setFogDistance, debugger slider
metadata:
  type: project
---

Plan 024 (`.claude/plans/024-fog.md`), DONE. GTA-style distance fog hiding the far map + streaming/LOD edge.

- `Config.fog: FogConfig { distance: number }` — default **800** (canvas-host) + the 4 config test fixtures.
- `FogPlugin` (`src/game/plugins/fog.plugin.ts`, registered in canvas-host like the light plugins):
  linear `THREE.Fog(FOG_COLOR, distance*0.4, distance)` on `scene.fog`, and `scene.background = FOG_COLOR`
  (0x9fb4c8) so the fully-fogged distance reads as horizon, not black (no sky system yet). Reacts to
  `Plugin.configChanged` to update the range live AND set `scene.fog = null` while `config.mapViewer` is
  on (no fog in the map inspector) — works because `setMapViewer`/`setFogDistance` both go through
  `Game.setConfig` → `configChanged`.
- `Game.setFogDistance(distance)` → `setConfig({ fog: { distance } })` (runtime change).
- Debugger Game screen: range slider 10–2000 (step 10) via `DebugActions.fogDistance()/setFogDistance()`.

Camera far plane (100000) untouched — fog + background hide everything beyond. Fog colour is a const for
now; later tie it to sky/timecyc. Related: [[world-streaming-plan]] (fade), [[in-game-debugger]].
