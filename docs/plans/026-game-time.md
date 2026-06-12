# 026 — Game time (clock)

## Goal

An in-game clock that later drives timecyc (sky/sun/lighting). `loadGame` receives a start time
(e.g. 6:00) and the game counts from there. **1 game-minute = N real seconds** (canvas-host **1.5**),
configurable in the initial config. A **Time** section in the debugger to jump to a time. (This is now its own
top-level **Time** tab — it was the "Game" section/screen when written.)
No visual effect yet — just console output now; a HUD clock + timecyc come later.

## Design

- **Representation:** minutes since midnight as a float (0–1440, wraps). `6:00 → 360`. A `HH:MM`
  formatter for console/debug. Float so the advance is smooth; the displayed/emitted value is the
  whole minute.
- **Config:** `Config.time: TimeConfig { secondsPerGameMinute: number }` (canvas-host 1.5) — real
  seconds per game-minute. A full day (1440 min) = 1440 × 1.5 = 36 real minutes.
- **Start time:** `Game.loadGame(center, { radius, startMinutes })` — `startMinutes` since midnight
  (canvas-host passes `360` = 6:00). Sets the clock; if omitted, a sensible default (e.g. 720 = noon).
- **`GameClock`** (`src/game/time/game-clock.ts`) — a small pure class (unit-tested, no three/loop):
  `advance(deltaSeconds, secondsPerGameMinute): boolean` (adds `deltaSeconds / secondsPerGameMinute`
  minutes, wraps mod 1440, returns true when the whole minute changed), `minutes` getter, `set(m)`,
  static `format(m): 'HH:MM'`.
- **Engine integration:** `Game` owns a `GameClock`, advances it in the render loop (next to
  `cameraController.update(delta)`); on a whole-minute change it emits a `'time'` `GameEvent`
  (`{ minutes }`) and logs `HH:MM` via the `Logger` (new `'time'` `LogType`) — that's the "console
  output" for now (visible when `showLogs` is on). `Game.getTime(): number` and `Game.setTime(minutes)`
  for the debugger and (later) timecyc consumers, which can read `getTime()` per frame or listen to
  `'time'`.

## Amendment — stop the clock when paused (DONE)

The clock **stops while the game is paused**: `Game` advances `gameClock` only while
`config.gameState === 'play'` (a guard around the loop's `gameClock.advance(...)`), so any non-play
state freezes the time of day and the HUD shows it frozen. Done with the HUD (plan 027).

## Status

DONE (iterations 1–2 + pause amendment). `Config.time.secondsPerGameMinute` (canvas-host 1.5), `GameClock`
(`src/game/time/game-clock.ts`, pure + tested), `Game` owns/advances it in the loop
(`getTime`/`setTime`, `'time'` event, `'time'` log type → console via Logger on minute change),
`loadGame({ startMinutes })` (canvas-host = 360 / 6:00). Debugger Game screen has a **Time** section:
live `HH:MM`, presets (00/06/12/18/21:00) + a 0–1439 slider → `DebugActions.gameTime/setGameTime`.
Iteration 3 (HUD clock + timecyc) is the later, separate work.

## Iterations

1. **Clock core + config + loadGame.** Add `TimeConfig` + `Config.time` (`{ secondsPerGameMinute:
   1.5 }` in canvas-host + the 4 config test fixtures). New `GameClock` (+ tests: advance accrues, wraps
   past midnight, minute-changed flag, `format`). `LoadOptions.startMinutes`; `Game` owns the clock,
   advances it in the loop, exposes `getTime`/`setTime`, emits `'time'`, logs via `Logger` (`'time'`
   type) on minute change. canvas-host: pass `startMinutes` (6:00) + `time` config.
2. **Debugger Time tab.** Game screen → **Time** section: a live `HH:MM` label (from `getTime`), quick
   preset buttons (00:00 / 06:00 / 12:00 / 18:00 / 21:00) and a slider (0–1439, step ~15) — both drive
   `DebugActions.setGameTime(minutes)` → `game.setTime`; `DebugActions.gameTime()` reads the current
   value. Setting the time is reflected in the console output.

## Touch list

- `src/game/interfaces/config.interface.ts` — `TimeConfig` + `Config.time`.
- `src/game/time/game-clock.ts` (+ `.test.ts`) — the pure clock.
- `src/game/game.ts` — own/advance the clock; `getTime`/`setTime`; `'time'` event; `LoadOptions.startMinutes`.
- `src/game/events/events.global.ts` — `time: { minutes: number }`.
- `src/game/diagnostics/logger.ts` — add `'time'` to `LogType`.
- `src/ui/canvas-host.tsx` — `time` config + `startMinutes` in `loadGame`; `DebugActions.gameTime/setGameTime`.
- `src/ui/debug/debug-overlay.tsx` — the Time tab (originally the "Game" screen).
- The 4 config test fixtures — add `time`.

## Out of scope (later)

HUD clock UI; timecyc (sky colour / sun position / ambient + directional light by time of day);
day/night object (Tobj) gating; pausing the clock with the game-state pause (can be added when needed).
```
