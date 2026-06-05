---
name: debug-panel-temporary
description: The Ctrl+D debug overlay is a TEMPORARY dev tool — remove it before shipping
metadata:
  type: project
---

`src/components/debug/` (`debug-panel.tsx`, `debug-types.ts`) is a **temporary** neon overlay for early/primary debugging — **must be removed** before shipping, along with its wiring.

**Why:** quick manual switching while bringing the map up; not a real feature.

**What it does (Ctrl+D toggles it; X button or Ctrl+D closes):** two radio groups + click-inspect —
- GEOMETRY: `Only Map` (default = exclude LODs, the normal render) / `Only LODs` (render only LOD stand-ins).
- CAMERA: `Ganton` (default = focus CJ's house AND load only that district, `FOCUS_RADIUS`≈400 units) / `Full Map` (load the whole map, fit bbox).
- SELECTED: while the popup is open, **`DEBUG_MODE` is true** and clicking a model reports its name / txd / GTA-world coords in the panel.

**`DEBUG_MODE` global** lives in `src/components/debug/debug-state.ts` (`debugState` store: `isEnabled/setMode/selection/select/subscribe`), mirrored to `window.DEBUG_MODE` for the console. **MUST be moved into a proper config module later** (per user). `DEBUG_MODE` follows the popup-open state.

**Wiring to unwind when removing:** state (`geometryMode`, `cameraTarget`) lives in `src/app.tsx` → `<DebugPanel>` + `<MapScene>`. `MapScene` consumes `geometryMode` + `focus` (focus also drives the district radius filter); `fit-camera.tsx` re-fits via `useEffect` on `focus` change. `model-instances.tsx` `InstancedPart` has an `onClick` that calls `debugState.select(...)` when `debugState.isEnabled()` — remove that. To revert: drop `components/debug`, the `debugState` import + onClick in model-instances, hard-set `MapScene` to map-only + fixed `focus`, remove the `geometryMode` prop. See [[binary-ipl-render-approach]] / [[map-pipeline]].
