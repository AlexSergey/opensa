# 020 — Diagnostics logging

## Goal

A structured, **filterable** log channel that is **off by default** and turns on from a single
config switch — so the temporary `console.log`s we keep adding to debug tricky moments become a
first-class, level/type-gated facility instead of throwaway lines (which `no-console` rejects).

## Design

- **Config switch** — `Config.showLogs: false | LogLevel` (`'debug' | 'log' | 'warn' | 'error'`).
  Default `false` (silent). Set it in `canvas-host.tsx` to activate; it's the live config object so
  it can also be flipped at runtime via `setConfig`.
- **Logger** (`src/game/diagnostics/logger.ts`) — `logger.debug/log/warn/error(type, message, data?)`.
  It reads the live `showLogs` floor; below the floor (or `false`) it returns immediately and emits
  **nothing** (zero overhead when off). Otherwise it emits a `'log'` event:
  `LogEntry { level, type, message, data? }`.
- **Type** (`LogType`) — a string union of areas (`'damage' | 'enter-vehicle' | 'physics' |
  'streaming' | 'vehicle'`) so subscribers can filter by area. Extend the union when a new system
  starts logging.
- **Event bus** — `GameEvents` gains `log: LogEntry`. The Logger is created in `Game` (over
  `this.events` + `this.config`) and handed out via `game.getLogger()`.
- **Single sink** — `canvas-host.tsx` subscribes once: `game.events.on('log', …)` → `console[level]`
  with a `[type]` tag. Level filtering already happened in the Logger; **type** filtering is a
  one-liner edited here when chasing a specific area (`if (type !== 'enter-vehicle') return;`).

## Wiring

- Systems that log take a `Logger` in their constructor (passed `game.getLogger()` from canvas-host).
  Done for `VehicleDamageSystem` and `EnterVehicleSystem`.
- `no-console` stays `error` everywhere except the one intentional sink in canvas-host
  (`// eslint-disable-next-line no-console`).

## Logs placed so far

- **damage** — `debug`: every contact `impact force=…` (recalibrate `STRONG_HIT` with
  `showLogs: 'debug'`); `log`: `deform <part>` / `detach <part>` with force.
- **enter-vehicle** — `debug`: `approach`; `log`: `seated`, `exited`.

## Convention (going forward)

When implementing something with tricky timing/order/physics interplay, **add a `logger.debug`
at the decision points** (with the relevant numbers as `data`) instead of a temporary `console.log`.
It costs nothing when off and is instantly inspectable by flipping `showLogs`.

## Out of scope

On-screen log overlay, log persistence/ring buffer, per-type config allowlist (filter in the sink
for now), throttling/rate-limiting noisy `debug` lines.
