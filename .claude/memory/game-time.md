---
name: game-time
description: In-game clock (plan 026) — GameClock, Config.time, Game.getTime/setTime, debugger Time tab
metadata:
  type: project
---

Plan 026 (`.claude/plans/026-game-time.md`), DONE — the foundation for timecyc (sky/sun later).

- Time = minutes since midnight, float, wraps at 1440. `6:00 = 360`.
- `Config.time.secondsPerGameMinute` (canvas-host = **1.5**): real seconds per game-minute (day = 36 real min); tunable.
- `GameClock` (`src/game/time/game-clock.ts`) — pure: `advance(deltaSeconds, secondsPerGameMinute)`
  (returns true when the whole minute changes), `minutes` getter, `set(m)`, static `format(m)→'HH:MM'`.
- `Game` owns a `GameClock`, advances it in the render loop; on a minute change emits the `'time'`
  `GameEvent` `{ minutes }` and logs `HH:MM` via the `Logger` (new `'time'` LogType — the "console"
  output, visible when `showLogs` is set). `Game.getTime()`/`setTime(minutes)`; `loadGame({ startMinutes })`
  seeds it (canvas-host passes 360 = 6:00; default noon).
- Debugger **Time** tab (formerly "Game"): live `HH:MM` + presets + 0–1439 slider via
  `DebugActions.gameTime()/setGameTime()` → `game.setTime`.
- No visual effect yet (no sky/sun). Next: HUD clock UI + timecyc consumers read `getTime()` / `'time'`.
  Related: [[fog]], [[in-game-debugger]], [[diagnostics-logging]].
