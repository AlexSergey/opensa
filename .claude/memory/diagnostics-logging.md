---
name: diagnostics-logging
description: Structured filterable log channel (plan 020) — use logger.debug at tricky spots instead of console.log
metadata:
  type: feedback
---

The project has a structured diagnostics log channel (plan 020, `.claude/plans/020-diagnostics-logging.md`).
Use it instead of throwaway `console.log` (which `no-console: error` rejects anyway).

- `Config.showLogs: false | LogLevel` (`'debug'|'log'|'warn'|'error'`) — **off by default**; flip it in
  `src/ui/canvas-host.tsx` to activate. Live config, so `setConfig` can toggle at runtime too.
- `src/game/diagnostics/logger.ts` — `Logger.debug/log/warn/error(type, message, data?)`. Below the
  configured floor (or when `false`) it emits nothing → zero overhead. Otherwise emits a `'log'`
  `GameEvents` event with `LogEntry { level, type, message, data? }`.
- `LogType` = string union of areas (`damage | enter-vehicle | physics | streaming | vehicle`);
  **extend the union** when a new system starts logging.
- Logger built in `Game`, handed out via `game.getLogger()`; pass it into systems' constructors.
- Single sink: `canvas-host.tsx` `game.events.on('log', …)` → `console[level]`. Filter by `type` there.

**Why:** the user wants the temporary debug logs we keep adding to be first-class — gated by level AND
type, off by default, activated/filtered in one place.
**How to apply:** when building anything with tricky timing/order/physics interplay, add
`logger.debug('<type>', '<what>', <numbers>)` at the decision points rather than a temporary console
line. Add the system's logger via its constructor (`game.getLogger()`). Related: [[vehicle-physics-plan]].
