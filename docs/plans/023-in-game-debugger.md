# 023 — In-game debugger (debug2)

## Goal

A new in-game debug panel (`debug2`, toggled with **F2**) with a multi-level menu of actual gameplay
debug actions (respawn, teleport, spawn/flip vehicles, show coords) — distinct from the existing
section-inspector overlay (Ctrl+X). Crucially, **opening F2 must NOT enter the map-viewer mode**; that
mode is entered only when the user explicitly activates it under the Map section.

The current `debugMode` is, in practice, only the map-inspector mode (manual cell render + click-pick +
free look), so it is renamed to **`mapViewer`** for clarity, and the Map section is the only thing that
turns it on.

The old `DebugOverlay` (Ctrl+X) stays during the transition; `debug2` is additive. The section
inspector it contains is reused by `debug2`'s Map screen (see iteration 4).

## Architecture

- **Component**: `src/ui/debug/debug-overlay2.tsx` (`DebugOverlay2`), mounted in `canvas-host.tsx`
  next to the existing overlay. Reuses the same `styles` skeleton (panel, ×, neon theme). F2 toggles
  `visible`.
- **Navigation**: a single `screen` state — `'root' | 'player' | 'vehicles' | 'game' | 'map'`. Root is
  the 4-item list; each sub-screen shows a **Back** button (→ root) plus its content. Closing (×/F2)
  resets to root.
- **World actions** (GTA-specific: spawn Tommy/cars, flip) cannot live on the generic `Game`. They are
  passed to `DebugOverlay2` as a `DebugActions` object built in `canvas-host` (which already has the
  player, physics, `spawnVehicle` factory, vehicle systems in scope). `bootstrap()` returns
  `{ game, debugActions }`; canvas-host holds both in state and passes `actions` to `DebugOverlay2`.
  Engine-level state (map viewer, pick) stays on `Game`.

```ts
interface DebugActions {
  flipVehicle(): void;                              // flips the occupied car (no-op if on foot)
  playerCoords(): Vec3;                             // live player position
  respawnPlayer(): void;                            // re-drop Tommy at his current spot (unstick)
  spawnVehicle(model: 'admiral' | 'camper'): Promise<void>; // in front of Tommy
  teleportToGanton(): void;
}
```

## Status

DONE. Iterations 1–4 shipped; the old Ctrl+X overlay was **deleted** and this one **renamed in place**
(it is now the only debug overlay). Remaining: "Camera fly mode for screenshots (without UI layer) K+M"
— tracked separately on the roadmap as its own mini-feature.

Files: `src/ui/debug/debug-overlay.tsx` (`DebugOverlay`, F2 panel + `DebugActions`), `map-inspector.tsx`
(map-viewer, owns the mode lifecycle on mount/unmount), `debug-styles.ts`; actions + in-front spawn +
flip wired in `canvas-host.tsx` (`bootstrap` returns `{ game, debugActions }`); getters
`CharacterAnimationSystem.getFacing()`, `EnterVehicleSystem.getActive()`. (Dropped: the old overlay's
Play/Pause — not in the new spec.)

## Iteration 1 — scaffold + F2 (no map-viewer on open)

- New `DebugOverlay2` with the copied panel skeleton + × close. Toggle `visible` on **F2**
  (`keydown`, `preventDefault`). Title e.g. `DEBUG 2`.
- It renders only the panel; **does not** call any map-viewer/`setDebugMode` API — opening it has zero
  effect on the simulation.
- Mount in `canvas-host.tsx` alongside `<DebugOverlay game={game} />`.

## Iteration 2 — multi-level menu

- `screen` state. **Root**: a vertical list of buttons — `Player`, `Vehicles`, `Game`, `Map`.
- Selecting one switches to that sub-screen, which (for now) shows only a **Back** button returning to
  root. Extract a small `MenuButton` + `BackButton` (or reuse a list-item style) to keep it tidy.

## Iteration 3 — Player + Vehicles actions (never enter map viewer)

Introduce the `DebugActions` prop + wiring in `canvas-host` (bootstrap returns it).

**Player** screen:
- **Respawn** → `actions.respawnPlayer()`: `placePlayer(viewOf(), true)` (re-teleports the kinematic
  capsule at the current spot, +small z lift) to unstick. `placePlayer` already teleports the body.
- **To Ganton** → `actions.teleportToGanton()`: `placePlayer(PLAYER_SPAWN, true)`.

**Vehicles** screen:
- **Admiral Spawn / Camper Spawn** → `actions.spawnVehicle('admiral' | 'camper')`: reuse the existing
  `spawnVehicle(placement)` factory **and** register the result with `vehicleLod` (so LOD/unload still
  apply). Placement: position = player position + the player's **facing** forward (expose
  `CharacterAnimationSystem.getFacing()` → forward vector) × clearance, where clearance derives from the
  loaded vehicle's `halfExtents` (from the COL bounds) so the car never overlaps Tommy regardless of
  model size; heading = player facing; z = player z.
- **Flip vehicle** → `actions.flipVehicle()`: only if a car is occupied. Expose
  `EnterVehicleSystem.getActive(): EnterableVehicle | null`. Read the body transform
  (`physics.readBody`), decide on-wheels vs on-roof from the world-Z component of the body's local up,
  roll the orientation 180° about the car's forward axis, lift z by ~1 m, and apply via the existing
  `physics.holdBody(handle, position, quat)` (one-shot teleport that also zeroes linear/angular
  velocity). On wheels → roof, on roof → wheels.

None of these touch `mapViewer`.

## Iteration 4 — Game + Map (+ rename `debugMode` → `mapViewer`)

**Rename** (do first in this iteration): `debugMode` → `mapViewer` across
`config.interface.ts`, `game.ts` (`setDebugMode` → `setMapViewer`, event `'debug-mode'` →
`'map-viewer'`), `events.global.ts`, `streaming.system.ts`, `canvas-host.tsx` (config init + the
event listener that gates click-pick), `debug-overlay.tsx` (old overlay's call), and the four config
test fixtures (`character-controller`, `collision-streaming`, `streaming`, `physics`).

**Game** screen:
- **Show coords** → reveals the live player coords (`actions.playerCoords()`, refreshed while shown).
- Once shown, a **Copy Coords** button appears → `navigator.clipboard.writeText(...)` of the coords.

**Map** screen:
- **Activate Map Viewer** (toggle) → turns on `mapViewer`: this is exactly today's overlay behaviour
  (manual cell selection/render, Show LODs, collision overlay, free look, click-to-pick + Selected
  info). The section inspector is reused: extract the inspector body from `DebugOverlay` into a shared
  piece (e.g. `MapInspector`) consumed by both, OR move it into `debug2`'s Map screen and retire it from
  the old overlay. While **not** activated, none of this is available.
- Leaving the Map screen (**Back**), closing the panel (×), or pressing **F2** turns `mapViewer` back
  **off** (and clears manual cells / selection), so you always exit cleanly.

## Out of scope

- Removing the old Ctrl+X overlay (kept until debug2 fully supersedes it).
- Persisting panel state; draggable/resizable panel; gamepad.
- New vehicle models beyond admiral/camper; spawning NPCs.
- Saved coord history (only current coords + copy).

## Follow-up (done): Map screen — Show Normals + draw-distance/fog sliders

The Map screen gained two extras (rendered while the map viewer is OFF; `MapScreen` /
`DrawDistanceControls` in `debug-overlay.tsx`):

- **Show Normals** — a scene-wide `MeshNormalMaterial` override (`game.setShowNormals`), drawn
  **straight to the screen, bypassing the post-FX pipeline** (in `Game`'s render loop) so the normals
  read clean. Auto-resets via `resetTo` (Back / × / F2) and when entering the map viewer.
- **Draw Distance / HD Distance / Fog** sliders — `game.setStreaming` (live `config.streaming`, plan
  009) + `game.setFogDistance` (plan 024). Fog moved here from Atmosphere; the Draw Distance slider
  couples fog to the LOD cull edge (`fog ≈ lod × 0.8`).
