# 036 — Follow camera (auto-trail + free mouse look + config/debug)

The play camera (`CameraController` **follow** mode) trails the player — on foot **or** in a car — from behind +
above, **auto-swinging behind them when they change direction**, while plain mouse movement lets the player look
around freely. All tuning lives in `Config.camera` and a debug **Camera** tab (placed above Graphics).

Status: **DONE.** Full suite green (365 pass).

## Behaviour (`src/game/core/camera-controller.ts`)

Follow mode orbits the camera on a sphere around a **raised** look point (target world pos + `followHeight` on
Y, so the frame sits off the feet): `azimuth` (yaw), `polar` (pitch from straight-up), `distance` (radius).
Per `update(delta)`:

- **Free mouse look (no button held):** plain `pointermove` orbits — `azimuth -= movementX·k`, `polar` clamped
  to `[followMinPolar, followMaxPolar]`. Each look stamps `lastManualMs = performance.now()`.
- **Auto-follow on a direction change *only*:** movement heading = `atan2(moveX, moveZ)` from the per-frame
  **world-position delta** (orientation-agnostic → works on foot + in cars, including reverse). A heading change
  faster than `TURN_THRESHOLD` (0.9 rad/s) **engages** a `following` state that eases `azimuth` toward *behind
  the movement* (`atan2(-moveX, -moveZ)`) at `followLerp`/second until settled (`SETTLE_EPSILON` = 0.03 rad),
  then clears. Walking/driving **straight never engages** → the angle the player set with the mouse is kept. A
  recent mouse look (`MANUAL_GRACE_MS` = 250) clears/suppresses following → *"turn while steering the camera"
  obeys the player.* **Pitch is never auto-touched** (manual only; `followPolar` is just the initial pitch).
  Below `MOVE_THRESHOLD` (0.5 u/s) the heading reference is frozen (stationary player can't drift the camera).
- **Wheel zoom (optional):** `distance` clamped to `[followZoomMin, followZoomMax]`.

`setMode` / `setTarget` reset `following` + heading + prev-target so re-entering follow (from debug/fly, or the
car↔foot target swap via `setFollowTarget`) doesn't jump.

> Known v1 limitation: heading = **movement** direction, so reversing a car swings the camera to the car's
> front (behind the backward motion). Intended for now; a facing-based heading is a later option.

## Config (`Config.camera` — `CameraConfig`)

| Field | Meaning | Default |
|---|---|---|
| `followDistance` | initial orbit radius (wheel moves it within the range) | 6 |
| `followHeight` | Y offset of the orbit/look point above the player's feet — raises the framing | 1.5 |
| `followPolar` | initial pitch (rad from straight-up); the mouse moves it after | 1.15 |
| `followMinPolar` / `followMaxPolar` | mouse pitch clamps | 0.25 / π/2−0.05 |
| `followLerp` | how fast it swings behind on a turn (per second) | 3 |
| `followZoom` | allow wheel zoom | true |
| `followZoomMin` / `followZoomMax` | wheel zoom range | 4 / 10 |

The **Angle / Distance / Height** trio matches the standard third-person-rig diagram. **Nuance:** `distance` is
the sphere radius, so Distance and Angle are slightly **coupled** in camera height (spherical, not a decoupled
back/up/pitch rig). A decoupled rig was offered and **deferred** — kept spherical for now.

## Debug (Camera tab, above Graphics)

`debug-overlay.tsx`: sliders **DISTANCE / MIN ZOOM / MAX ZOOM / HEIGHT / ANGLE / RESPONSE / MIN·MAX ANGLE** + a
**Wheel zoom** toggle, all → `game.setCamera(patch)` (live; merges into `camera`). A **CURRENT ZOOM** readout
polls `game.getCameraDistance()` (the live wheel distance) every 200 ms while the tab is open.

## Wiring

- `game.setCamera(Partial<CameraConfig>)` — merges into `camera`; on `followDistance` also calls
  `cameraController.setDistance` to keep the live (wheel) distance in sync. `game.getCameraDistance()` exposes it.
- `CameraConfig` re-exported from the game barrel; `DebugActions.camera() / cameraDistance() / setCamera()`
  wired in `canvas-host`. The **4 config test fixtures** carry the full `camera` block.
