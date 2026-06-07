---
name: engine-refactor-status
description: Status of the game/renderware engine refactor (plan 006) + the current src layout
metadata:
  type: project
---

Framework-agnostic engine refactor. Plan: `.claude/plans/006-engine-refactor.md`. Two layers: generic **`game`** (never imports renderware) + GTA-SA **`renderware`**, bridged only by `game/adapters` (eslint `no-restricted-imports` on `src/game/**` except `src/game/adapters/**`).

**Phases 0–5 — DONE (2026-06-05). R3F fully removed; the engine drives the render imperatively.** Only phase 6 (dynamics: COL → streaming/LOD → bitECS → Rapier) remains, each as its own follow-up plan.

**Current `src/` layout:**
- `game/` — generic engine. `game.ts` = **`Game` singleton** (`getInstance/addPlugin/setWorldAdapter/init/loadGame/setDebugMode/setConfig/pick/resize/dispose` + `events`); owns renderer/scene/camera/loop. `core/` = `renderer`, `clock`, `system` (SystemRegistry, dynamics-ready), `camera-controller` (OrbitControls + bbox framing — **controls live here, not a plugin**). `events/` = typed **`EventBus`** (own, not eventemitter3) + `events.global` (`GameEvents`). `plugins/` = `Plugin`/`PluginContext`/`RenderPipeline` + `BasicRenderPipeline` + `AmbientLight`/`DirectionalLight` plugin classes. `interfaces/` = `Config`, `WorldAdapter`. `adapters/gta-sa-world.adapter.ts` = **the only renderware importer** (wraps meshes in a −90°X group; `prepare` is idempotent so debug reloads skip re-download).
- `renderware/` — `parsers/{binary,text}`, `archive` (WIMG img-archive, asset-cache, model-key), `three` (buildClump(Parts), buildTexture), `map` (`resolveMap`, `buildRegion`→InstancedMesh[] with conjugated IPL quat + `userData.region={def,instances}` for picking). `index.ts` is the barrel (`export *` works in vite/vitest; **fails only under tsx** ad-hoc scripts → probe scripts import sub-paths).
- `ui/` — **the only React surface.** `canvas-host.tsx` (module-scope bootstrap promise = StrictMode-safe; mounts `<canvas>`, forwards resize/click→`game.pick`, shows preloader), `debug/debug-overlay.tsx` (F2 menu; drives engine via `Game` methods + `select` event; see [[in-game-debugger]]), `locations.ts` (Ganton coords). `main.tsx` renders `<CanvasHost>`.

**Key divergences from plan 006:** no eventemitter3 (custom typed EventBus); `use`→`addPlugin`; no `refresh()` (reload = call `loadGame` again, which disposes prev region geometry/materials, keeps shared textures, re-frames); no `ControlsPlugin` (folded into CameraController); no `public-api.ts` (methods on `Game`). See [[map-pipeline]] / [[renderware-loader]] for relocated details.
