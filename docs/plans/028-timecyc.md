# 028 — Timecyc (parse + 24h convert + sampler)

## Goal

Load GTA SA's `timecyc` (per-weather, per-time-of-day colour/lighting table) into a clean structure with
a **sampler** (given weather + fractional hour → interpolated entry), ready for the later sky/sun/light
work.

We **always work with the 24h format internally**. Source selection:
- `timecyc.dat` is **mandatory** (always present) — the fallback; it is the vanilla 8-keyframe table and
  **must** be run through `convertTo24h`.
- `timecyc_24h.dat` is **optional** — if present, it is already 24h, so parse it **as-is** (do **not**
  run `convertTo24h` on it). When absent, convert `timecyc.dat`.

This plan delivers the **data layer only** — no rendering yet (sky dome, sun/moon, ambient/directional
light, fog colour, water colour are the next plan that *consumes* this).

## Data facts (verified on the real files)

- **Field schema** (the Python `fielddef`, in order): `Amb`(RGB), `Amb_Obj`(RGB), `Dir`(RGB),
  `Sky top`(RGB), `Sky bot`(RGB), `SunCore`(RGB), `SunCorona`(RGB), `SunSz`,`SprSz`,`SprBght`(float),
  `Shdw`,`LightShd`,`PoleShd`(int), `FarClp`,`FogSt`,`LightOnGround`(float), `LowCloudsRGB`(RGB),
  `BottomCloudRGB`(RGB), `WaterRGBA`(RGBA), `Alpha1`(int),`RGB1`(RGB),`Alpha2`(int),`RGB2`(RGB),
  `CloudAlpha`(int), `IntensityLimit`(int), `WaterFogAlpha`(int), `DirMult`(float) — 27 fields = 52 raw
  numbers per line. Vanilla lines omit the last field(s) → defaults (the Python `getval`: missing int
  `-1000`, float `1.0`, RGB `[-100,…]`).
- **`timecyc.dat`**: 184 non-comment lines = **23 weathers × 8 keyframes** (Midnight, 5AM, 6AM, 7AM,
  Midday, 7PM, 8PM, 10PM). Lines are whitespace-separated; `//` comments and blanks skipped.
- **`timecyc_24h.dat`**: 552 lines = **21 weathers × 24 hours** (504) + the last 2 weathers
  (EXTRACOLOURS_1/2) kept at 8 lines (16) + 32 padding copies of the last line — exactly what the Python
  emits. Only the first **504** (21 time-based weathers × 24h) matter for time-of-day.
- 23 weather names + the 8 keyframe → 24h interpolation table are fixed (from the Python `make24h`).

## Design

`src/renderware/parsers/text/timecyc/` (or `timecyc.parser.ts` + helpers), renderware-agnostic, barrel-
exported like `water`/`carcols`:

- **`timecyc-fields.ts`** — the field schema (`{ name, kind: 'rgb'|'rgba'|'int'|'float' }[]`) + the 23
  `WEATHER_NAMES`.
- **`parseTimecyc(text): number[][]`** — each non-comment line → a flat numeric row (reads per the
  schema; missing fields → the Python defaults). Used for both files.
- **`convertTo24h(rows8: number[][]): number[][]`** — JS port of the Python `make24h`/`interpolate`:
  per weather, the 8 keyframes → 24 hourly rows (the exact fixed blend fractions: 1AM–4AM from
  Midnight↔5AM at k/5, 8AM–11AM from 7AM↔Midday at k/5, 1PM–6PM from Midday↔7PM at k/7, 9PM from
  8PM↔10PM, 11PM from 10PM↔Midnight). **Replicate the Python rounding** (ints truncate, floats round to
  2 dp) so a converted `timecyc.dat` matches the provided `timecyc_24h.dat`. Applies to the first 21
  weathers only (extracolours/padding ignored for time-of-day).
- **`buildTimecyc(rows24): Timecyc`** — group the first 21×24 rows into a friendly structure:
  `Timecyc = { weathers: { name: string; hours: TimecycHour[24] }[] }`, where `TimecycHour` has named,
  typed fields (`ambient`, `ambientObj`, `directional`, `skyTop`, `skyBottom`, `sunCore`, `sunCorona`,
  `sunSize`, `farClip`, `fogStart`, `lowClouds`, `bottomClouds`, `water`, `directionalMult`, … as
  `[r,g,b]` / numbers).
- **`sampleTimecyc(timecyc, weatherIndex, hour): TimecycHour`** — `hour` fractional 0–24 (wraps); lerps
  every field between `floor(hour)` and the next hour by the fraction (no rounding — smooth for render).
  This is what the sky/sun/light consumers call each frame with `game.getTime()/60`.

## Status

DONE (iterations 1–4). `src/renderware/parsers/text/timecyc.parser.ts` (`FIELDS`, `WEATHER_NAMES`,
`parseTimecyc`, `convertTo24h`) + `timecyc.ts` (`Timecyc`/`TimecycHour` types, `buildTimecyc`,
`sampleTimecyc`), barrel-exported. `GtaSaWorldAdapter.loadTimecyc()` (24h-as-is, else convert vanilla).
canvas-host loads it and logs the sampled entry on the `'time'` event (gated). Tests:
`timecyc.parser.test.ts` (184/552 rows, keyframe copy, interpolation) + `timecyc.test.ts`
(build + sample). NOT exposed on the generic `Game`/`WorldAdapter` (Timecyc is a renderware type — the
layer rule keeps it off `game/**`; canvas-host/adapter use it directly).

**100% parity:** `convertTo24h(parseTimecyc(timecyc.dat))` equals the first 504 rows of
`parseTimecyc(timecyc_24h.dat)` **byte-for-byte** (asserted in `timecyc.parser.test.ts`). To get there,
`parseTimecyc` faithfully mirrors the reference tool's `getval`: strict integer parsing for int/RGB(A)
fields (a decimal token like `"2.00"` fails, as Python `int()` does) and its exact on-failure cursor
advances (int/float → `i+i`, RGB → `i+3`, RGBA → `i`). These quirks only matter for the few corrupt
vanilla lines (e.g. RAINY_COUNTRYSIDE 8pm has 49 tokens, not 51); clean files are unaffected.

## Iterations

1. **Field schema + line parser.** `timecyc-fields.ts` + `parseTimecyc`. Tests: parse real
   `timecyc.dat` → 184 rows of 52 numbers (defaults applied); parse `timecyc_24h.dat` → 552 rows.
2. **8 → 24h converter.** `convertTo24h` (the make24h/interpolate port + matching rounding). Test:
   `convertTo24h(parseTimecyc(timecyc.dat))` equals the first 504 rows of `parseTimecyc(timecyc_24h.dat)`
   (the JS port reproduces the bundled 24h file).
3. **Structured `Timecyc` + sampler.** `buildTimecyc` + `sampleTimecyc` (+ `TimecycHour` type). Tests:
   field mapping (e.g. weather 0 hour 0 ambient = `[22,22,22]`), interpolation at a half-hour, hour wrap
   23→0.
4. **Loading seam.** `WorldAdapter.loadTimecyc()` in `GtaSaWorldAdapter`: **try** the optional
   `timecyc_24h.dat` → parse **as-is** (already 24h, no convert). On miss/404, load the **mandatory**
   `timecyc.dat` → `convertTo24h`. Either path → `buildTimecyc` (always 24h internally). Wire in
   `prepare`/canvas-host so it's ready with the scene; expose on `Game` (e.g. `getTimecyc()`), and a quick
   console log of the sampled entry at the current `game.getTime()` to verify. (Current weather defaults
   to a sunny index for now; selectable later.)

## Touch list

- `src/renderware/parsers/text/timecyc*` (+ barrel export) — schema, parser, converter, builder, sampler (+ tests).
- `src/game/interfaces/world-adapter.interface.ts` + `gta-sa-world.adapter.ts` — `loadTimecyc()`.
- `src/ui/canvas-host.tsx` / `src/game/game.ts` — load + expose `getTimecyc()`.
- (Maybe) `Config` — default/initial weather index.

## Out of scope (next plan — consumers)

Sky dome + gradient (skyTop/skyBottom), sun/moon position + corona/sprite, ambient + directional lights
from timecyc (driving `AmbientLightPlugin`/`DirectionalLightPlugin`), fog colour/`FarClp`/`FogSt` from
timecyc (feeding plan 024 fog), water colour, weather selection/transitions, and the EXTRACOLOURS
palettes. This plan only prepares + samples the data.
