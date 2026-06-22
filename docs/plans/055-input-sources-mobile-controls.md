# 055 — Pluggable input sources + mobile on-screen controls

**Status: 🟡 PHASE 1 DONE (2026-06-22); Phase 2 (mobile) pending.** Two phases — (1) a device-agnostic input
layer the game reads (behaviour-preserving refactor), (2) the mobile on-screen controls + touch look as an
additive UI module. Builds on the existing `src/game/input/` (`Keyboard`), the `ControlsConfig` keymap, the
movement systems ([016](./016-enter-vehicle.md)/[017](./017-vehicle-driving.md), character-controller) and the
camera ([036](./036-follow-camera.md), [022](./022-debug-viewers.md)).

> **Phase 1 implemented (2026-06-22).** `InputState` contract (`move()`/`isActive()`/`consumeLook()`/
> `consumeZoom()`), `CombinedInput` combiner, `KeyboardSource` (WASD/actions) and `PointerLookSource`
> (mouse look/zoom). `character-controller`, `enter-vehicle` and `CameraController` now read `InputState`;
> `Game` owns the combined input (`getInput()`/`addInputSource()`, pointer source created at camera setup),
> `setup-character` registers the keyboard source. Files are grouped by source:
> `input/{input-state,combine-input}.ts` + `input/keyboard/{keyboard,keyboard-source}.ts` +
> `input/pointer/pointer-look-source.ts` (`index.ts` barrel). Edge detection stays in `enter-vehicle` (no
> `wasPressed` API yet — added if a consumer needs it). Tests: combiner, keyboard-source, pointer-look-source,
>
> - the refactored system tests. **Phase 2 (mobile touch sources + `src/ui/controls/` overlay) is unstarted.**

## Context / problem

Input enters the game in **three** device-coupled places:

1. **Movement / actions** — systems call `keyboard.isDown(controls.<action>)`, where `ControlsConfig` maps an
   action to a `KeyboardEvent.code`. Axes are digital (`isDown(pos) - isDown(neg)`). The device **and** the
   key bindings are baked into game logic (`character-controller.system.ts`, `enter-vehicle.system.ts`).
2. **Look (camera)** — `CameraController` attaches its own `pointermove`/`wheel`/`keydown` listeners and reads
   `event.movementX/Y` for the follow-orbit (azimuth/polar) and fly (yaw/pitch) look, plus wheel zoom. Mouse is
   wired directly into the game core; there is no seam for a touch look.
3. **Debug / fly** — OrbitControls + arrow keys via their own listeners.

So "mouse look" is really **look deltas (azimuth/polar, yaw/pitch) + zoom delta**, and none of it is abstracted.
A touch device cannot produce key codes or `movementX/Y`, so mobile has no path in today.

## Goal

The game consumes **device-agnostic signals (intents)**; concrete **input sources** (keyboard, pointer, touch
overlay, later gamepad) feed them and are pluggable. The on-screen mobile controls + touch look live **outside**
the game core (in `src/ui/`), so the game stays DOM/React-agnostic — same boundary as the asset loaders.

## Design — the intent layer (`src/game/input/`)

Two signal shapes cover every current input:

- **Continuous**
  - `move: Vec2` in [-1,1]² (forward/back, strafe) — keyboard → ±1, joystick → analog; also drives vehicle
    throttle/steer.
  - `look: Vec2` — per-frame delta, **read-and-cleared each tick** (identical for mouse `movementX/Y` and a
    touch-drag delta); integrated by the camera.
  - `zoom: number` — per-frame delta (wheel or pinch).
- **Discrete actions** — `jump`, `run`, `enterExit`, `brake/handbrake` (extensible). Exposed as **held**
  (`isActive`) **and edge** (`wasPressed`, consumed-once): enter/respawn want the edge, forward/run want held.

Contract:

- `InputState` (read side, what the game consumes): `axis2('move')`, `consumeLook()`, `consumeZoom()`,
  `isActive(action)`, `wasPressed(action)`.
- `InputSource` (write side) + a small **combiner** that merges all active sources: OR booleans, clamp-sum
  axes, accumulate look/zoom deltas. Pure and unit-testable.
- `Action` — a semantic union (`Forward`/`Back`/`Left`/`Right`/`Jump`/`Run`/`EnterExit`/`Brake`/…) replacing
  stringly-typed key codes in game logic.

Mirrors the `AssetLoader`/`AssetSink` pattern (one contract, many implementations).

## Sources (the external adapters)

- **`KeyboardSource`** (headless, `src/game/input/`) — wraps the existing `Keyboard` + the `ControlsConfig`
  keymap → emits `move`/actions. The key-code bindings **move out of the game core into this source** (they are
  keyboard-specific; also the seam for future remapping).
- **`PointerLookSource`** (desktop, `src/game/input/`) — `pointermove` (optionally pointer-lock) + `wheel` →
  `look`/`zoom`. The mouse logic extracted out of `CameraController`.
- **Touch overlay** (`src/ui/controls/`, React/DOM over the canvas) — on-screen joystick → `move`, buttons →
  actions, a look-pad / drag region → `look`, pinch → `zoom`. Renders DOM, so it lives in the UI layer and only
  feeds the same intent (game core imports no React). **This is the mobile module.**
- (future) `GamepadSource`.

Multiple sources coexist (keyboard + touch both wired); the combiner handles overlap.

## Phase 1 — input layer + refactor (behaviour-preserving, no UI change)

| Area                                                  | Change                                                                                                                                                                                                                          | Risk    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `input/` contract + combiner                          | new `InputState`/`InputSource`/`Action` + merge logic (pure, tested)                                                                                                                                                            | low     |
| `KeyboardSource`                                      | wrap current `Keyboard` + `ControlsConfig` → intents; 1:1 behaviour                                                                                                                                                             | low     |
| `character-controller.system`, `enter-vehicle.system` | `isDown(controls.x)` → `axis2`/`isActive`/`wasPressed`; math is already scalar, so mechanical (bonus: analog steer/throttle). Tests' `hold('KeyW')` stub → `setMove`/`press` (simpler)                                          | low-med |
| `CameraController`                                    | drop its own `pointermove`/`wheel`/arrow listeners; consume `look`/`zoom` in `update(delta)`. Orbit + auto-follow + fly math **unchanged** — only the delta source changes. Debug OrbitControls may stay DOM-coupled (dev tool) | med     |
| Wiring (`canvas-host`)                                | build sources, register in the combiner, pass `InputState` to Game/systems/camera                                                                                                                                               | low     |

Outcome: keyboard + mouse play exactly as today, but the game reads intents. Fully under green tests.

## Phase 2 — mobile controls (additive, UI only)

- `src/ui/controls/` — touch overlay React components over the canvas: a movement joystick (→ `move`), action
  buttons (jump/enter/brake → actions), a look-pad or right-half drag region (→ `look`), pinch-to-zoom
  (→ `zoom`). Each feeds the Phase-1 combiner. `pointer` events (touch + stylus).
- Platform detection (coarse pointer / no hover) decides whether the overlay mounts; desktop keeps keyboard +
  pointer. Safe-area insets + layout.
- No game-core changes — sources only.

## Scope

- **In:** the intent contract + combiner; keyboard & pointer sources; refactor of the two movement systems and
  the camera to read `InputState`; the touch overlay + touch look/zoom; platform detection for the overlay.
- **Out (later):** key/button remapping UI (the `Action→code` map makes it cheap); gamepad source; on-screen
  debug-camera controls (debug stays mouse/OrbitControls); haptics; aiming/shooting actions.

## Decisions to lock

- **Pull model** — systems read `InputState` each tick + edge flags cleared per tick (matches today's
  `isDown` polling and the fixed-step loop). Not an event bus.
- **Look/zoom as accumulated deltas** cleared on read — identical handling for mouse and touch drag.
- **`Action` enum in game logic**; `ControlsConfig` retained but owned by `KeyboardSource` as the `Action→code`
  map.
- Game core stays DOM/React-free; all DOM-bound sources (touch overlay) live in `src/ui/`.

## Testing

- Unit: combiner merge semantics; `KeyboardSource` (code→intent); systems over a fake `InputState`
  (replaces the current keyboard stubs — simpler); camera consuming synthetic look/zoom deltas.
- e2e: a touch-emulation spec for the overlay (joystick → movement, buttons → actions) on the Playwright lane.

## Risks / notes

- `CameraController` is the most intricate touch point, but the orbit/auto-follow maths is untouched — only the
  delta ingress moves. Keep its public API (`setMode`/`setTarget`/`focus`/…) stable.
- Keep Phase 1 strictly behaviour-preserving so the diff is reviewable and the existing system/camera tests stay
  meaningful; ship mobile (Phase 2) only after Phase 1 is green.
- Naming (per the input-module discussion): `input/` = contract + headless sources; `controls` = the keybinding
  map (now inside `KeyboardSource`) and the UI overlay name (`src/ui/controls/`); `*-controller` unchanged
  (entity drivers that consume `InputState`).
