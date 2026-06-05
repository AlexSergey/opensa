---
name: debug-panel-temporary
description: The Ctrl+D debug overlay is a TEMPORARY dev tool — remove it before shipping
metadata:
  type: project
---

`src/ui/debug/debug-overlay.tsx` is a **temporary** neon overlay for early/primary debugging — **must be removed** before shipping, along with its mount in `ui/canvas-host.tsx`.

**Why:** quick manual switching while bringing the map up; not a real feature.

**What it does (Ctrl+D toggles it; X button or Ctrl+D closes):** two radio groups + click-inspect —
- GEOMETRY: `Only Map` (default = exclude LODs, the normal render) / `Only LODs` (render only LOD stand-ins).
- CAMERA: `Ganton` (default = focus CJ's house AND load only that district, `GANTON_RADIUS`≈400 units) / `Full Map` (load the whole map, fit bbox). Both call `game.loadGame(center, { geometry, radius })`.
- SELECTED: while the popup is open, the game runs in **debug mode** (`game.setDebugMode(true)`) and clicking the canvas raycasts → `game.pick()` → emits `select` → the panel shows the model's name / txd / GTA-world coords.

**Debug mode** is now `Config.debugMode` on the `Game` singleton (set via `game.setDebugMode`, broadcast on the `debug-mode` event) — the old `debugState` store + `window.DEBUG_MODE` global are **gone** (removed in the engine refactor; see [[engine-refactor-status]]).

**Wiring to unwind when removing:** the overlay holds its own `geometryMode`/`cameraTarget` React state and drives the engine through `Game` methods only (no scene coupling). `ui/canvas-host.tsx` gates `game.pick` on the `debug-mode` event (only raycasts while the overlay is open). To revert: drop `ui/debug/`, remove `<DebugOverlay>` + the `debug-mode`/pick wiring in `canvas-host.tsx`, and hard-set the bootstrap `loadGame` to the desired fixed region. See [[binary-ipl-render-approach]] / [[map-pipeline]] / [[engine-refactor-status]].
