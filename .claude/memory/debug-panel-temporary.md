---
name: debug-panel-temporary
description: The Ctrl+X debug overlay is a TEMPORARY dev tool — remove it before shipping
metadata:
  type: project
---

`src/ui/debug/debug-overlay.tsx` is a **temporary** neon overlay for early/primary debugging — **must be removed** before shipping, along with its mount in `ui/canvas-host.tsx`.

**Why:** quick manual switching while bringing the map up; not a real feature.

**What it does (Ctrl+X toggles it; X button or Ctrl+X closes):** while open the game runs in **debug mode** (`game.setDebugMode(true)`) and streaming is suspended; the panel drives a manual **section inspector** plus play/pause, collision wireframe, and click-inspect.
- GAME: `Play` / `Pause` radio → `game.setGameState`.
- SECTIONS: a spatial checkbox grid of **every map cell** (`game.listCells()` → adapter `listCells()` → grid keys), laid out by absolute `cx,cy` (north at top), tinted by GTA region (Los Santos / San Fierro / Las Venturas / Countryside via `regionOf` on cell-centre coords — approximate bounds), scrollable. Checking cells → `game.setManualCells(absoluteCells, showLods)`. A **Whole map** checkbox selects/clears all; **Show LODs** renders the checked cells as LOD. Seeds with the current view cell on open.
- COLLISION: `Show` / `Hide` → `game.setShowCollision`.
- SELECTED: clicking the canvas raycasts → `game.pick()` → emits `select` → shows the model's name / txd / GTA-world coords.

**Debug mode** is now `Config.debugMode` on the `Game` singleton (set via `game.setDebugMode`, broadcast on the `debug-mode` event) — the old `debugState` store + `window.DEBUG_MODE` global are **gone** (removed in the engine refactor; see [[engine-refactor-status]]).

**Wiring to unwind when removing:** the overlay holds its own React state (selected cells, showLods, …) and drives the engine through `Game` methods only (no scene coupling) — `setDebugMode`, `setManualCells`, `getViewCell`, `listCells`, `setGameState`, `setShowCollision`, `pick`. `ui/canvas-host.tsx` gates `game.pick` on the `debug-mode` event (only raycasts while the overlay is open). To revert: drop `ui/debug/`, remove `<DebugOverlay>` + the `debug-mode`/pick wiring in `canvas-host.tsx`. The `WorldAdapter.listCells()` / `Game.listCells()` seam was added for the inspector — remove if no longer used elsewhere. See [[binary-ipl-render-approach]] / [[map-pipeline]] / [[engine-refactor-status]].
