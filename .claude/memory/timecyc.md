---
name: timecyc
description: Timecyc parse/convert/sample (plan 028) — 24h colour-lighting table; data layer for sky/sun
metadata:
  type: project
---

Plan 028 (`.claude/plans/028-timecyc.md`), DONE — data layer only (consumers = next plan: sky/sun/light).

- `src/renderware/parsers/text/timecyc.parser.ts`: `FIELDS` (27-field schema, in file order; RGB=3/RGBA=4/
  int/float=1 → 52 numbers/row), `WEATHER_NAMES` (23; first **21** are time-of-day), `parseTimecyc(text)`
  → flat numeric rows (missing trailing fields → vanilla defaults: int -1000, float 1, rgb/rgba -100),
  `convertTo24h(baseRows)` → 21×24 rows (JS port of the make24h/interpolate algorithm; floats round 2dp,
  others truncate).
- `timecyc.ts`: `Timecyc`/`TimecycWeather`/`TimecycHour` (+ `Rgb`/`Rgba`), `buildTimecyc(rows24)` (groups
  first 21×24), `sampleTimecyc(tc, weatherIndex, hour)` → interpolated `TimecycHour` at fractional hour
  (wraps 24). Consumers call `sampleTimecyc(tc, weather, game.getTime()/60)`.
- Loading: **always 24h internally.** `GtaSaWorldAdapter.loadTimecyc()` — optional `timecyc_24h.dat`
  parsed **as-is**; else mandatory `timecyc.dat` → `convertTo24h`. (`tryFetchText` returns null on 404.)
  Loaded in canvas-host; sampled entry logged on the `'time'` event (gated by showLogs).
- Layer note: `Timecyc` is a renderware type → NOT on the generic `Game`/`WorldAdapter`; canvas-host and
  the concrete adapter use it directly.
- **100% parity (tested):** `convertTo24h(parse(timecyc.dat))` == first 504 rows of `parse(timecyc_24h.dat)`
  byte-for-byte. `parseTimecyc` mirrors the reference `getval` exactly — strict int parsing for int/RGB(A)
  (decimal token like `"2.00"` fails like Python `int()`) + its on-failure cursor advances (int/float→`i+i`,
  rgb→`i+3`, rgba→`i`). Needed only for corrupt vanilla lines (e.g. RAINY_COUNTRYSIDE 8pm has 49 tokens).

Related: [[game-time]] (provides the hour), [[fog]] (will take FarClp/FogSt + fog colour), [[hud-layer]].
