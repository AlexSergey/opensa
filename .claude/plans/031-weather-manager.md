# 031 — Weather manager

Extends [[029-graphics]] from **EXTRASUNNY_LA only** to **all timecyc weathers except rain/storm**
(sunny / cloudy / foggy / smog / desert), wired through every timecyc-driven module (sky, clouds,
sun, lights, shadows, fog, water, reflections) and switchable from a debug **Weather** tab.
**Goal stays: best picture for least cost.** Status: **DONE** (transitions + rain/storm are future).

## Principles

- **One source of truth: the current weather index** (owned by `WeatherTransition`; the initial value is a
  `loadGame` param like the start time, *not* engine `Config`). Every sampler reads `game.getWeatherBlend()`
  so a single switch re-colours the whole scene. No per-module weather state. (`config.weatherTransitionSeconds`
  — the ease duration — *is* a Config setting.)
- **Timecyc-driven where the data is good, curated where it isn't.** Sky/fog/water/sun colours come
  straight from `sampleTimecyc(weather, hour)`. Clouds are the exception — the raw `cloudAlpha` doesn't
  read as the weather's name, so cloud **look** is a small hand-tuned profile keyed off the weather name.
- **Cheap.** No new passes. Cloud/lighting changes are a few extra uniform writes + one extra fbm in the
  existing sky-dome shader; heavy overcast actually *saves* the shadow pass (skipped when shadows fade out).
- **Rain/storm/underwater/extracolours excluded** (per the ask — no precipitation system yet).

## Architecture

- **Current weather** lives in `WeatherTransition` (not `Config`); seeded by `loadGame({ weather })`
  (defaults to `DEFAULT_WEATHER`, like `startMinutes` for time). `Game.getWeather()` returns the committed
  target; `setWeather(i)` eases the transition and calls `broadcastConfigChanged()` so weather-dependent
  plugins (the reflection sky probe) refresh. `config.weatherTransitionSeconds` holds the ease duration.
- **`WEATHER_NAMES`** (re-exported from the renderware text parser) — the 23 timecyc weather labels;
  the UI builds the selectable list from it, filtering `RAINY|SANDSTORM|UNDERWATER|EXTRACOLOUR`.
- **Samplers in canvas-host** (`skySample`/`waterSample`) read `game.getWeather()` instead of a fixed
  `EXTRASUNNY_LA`, so the whole graphics stack follows the switch with no per-plugin wiring.
- **`cloud-profile.ts`** (`game/plugins/`, renderware-free) — `cloudProfile(weatherName) →
  { coverage, darkness }`. The curated cloud look per weather family.
- **Debug Weather tab** (`debug-overlay.tsx`) — buttons per selectable weather; current one marked.
  `VehicleReflectionPlugin.configChanged` resets `probeHour = NaN` so the sky reflection probe
  re-renders after a weather change.

## What was done — phases

1. ✅ **Weather plumbing.** Current weather as a `loadGame({ weather })` param (seeded into
   `WeatherTransition`, *not* `Config` — like the start time), `Game.getWeather/setWeather`, `WEATHER_NAMES`
   export. canvas-host samplers switched from the hard-coded `EXTRASUNNY_LA` to the live weather. Reflection
   probe refreshes on weather change (`broadcastConfigChanged`).

2. ✅ **Debug Weather tab.** New `Screen` `'weather'` after Graphics in the menu; `DebugActions` gained
   `setWeather` / `weather` / `weatherList`; the tab renders one button per non-rain/storm weather and
   marks the active one (`●`). Switching re-colours sky/fog/water/clouds/reflections live.

3. ✅ **Per-weather clouds (`cloud-profile.ts`).** Raw `cloudAlpha` replaced by a curated profile so the
   sky reads as its weather name. Profiles (matched by name; `EXTRASUNNY` before `SUNNY` since it's a
   substring; `SMOG` adds a haze bump):

   | family | coverage | darkness | look |
   |---|---|---|---|
   | EXTRASUNNY | 0.14 | 0.0 | near-clear, a few light wisps |
   | SUNNY | 0.32 | 0.06 | scattered light clouds |
   | FOGGY | 0.80 | 0.20 | mostly covered, light grey |
   | CLOUDY | 1.00 | 0.90 | fully overcast, dark storm cells |
   | *(smog +)* | +0.08 | +0.06 | hazier variant of the base |
   | *(fallback)* | 0.50 | 0.30 | — |

   `SkySample` gained `cloudCover` + `cloudDark`; both feed the sky-dome shader.

4. ✅ **Cloud-shader calibration.** fbm values cluster mid-range, so the coverage→threshold map was
   recalibrated: `edge = mix(0.92, -0.25, coverage)` → 0 = clear, 1 = genuinely solid overcast, 0.5 ≈ half
   sky. Added a **large-scale `mass` fbm** so a fully overcast sky still has structure (dark storm cells vs
   lit cores) instead of a flat fill; `darkness` deepens the contrast (dark regions drop to ~16% brightness).

5. ✅ **Sun + lighting follow cloud cover** (`sky.plugin.ts`, driven by `cloudCover`):
   - **Hide the sun under cloud:** `cloudFade = 1 - smoothstep(cover, 0.45, 0.85)` fades the sun disc,
     corona and god-rays opacity; fully hidden + skipped past 0.85.
   - **Dim direct light:** `overcast = smoothstep(cover, 0.3, 0.95)`; directional intensity ×`(1 - 0.8·overcast)`.
   - **Soften shadows:** `sun.shadow.intensity = 1 - overcast` — shadows fade to none under heavy cloud, and
     the shadow-map pass is **skipped** once `shadow.intensity ≤ 0.01` (cheaper overcast).
   - **Lift ambient** (`+0.35·overcast`) so overcast reads as bright flat diffuse light, not dark.

6. ✅ **Water uses timecyc alpha** (`water.plugin.ts`). The deep-water tint is still raw timecyc
   `WaterRGBA.rgb` (no recolour), but two fixes stopped it looking washed-out: the texture-detail
   modulation is now darken-only (`0.5 + 0.4·tex`, ≤1, was `0.75 + 0.5·tex`), default
   `water.reflection` 0.6 → 0.4, and the dropped **alpha is now used as opacity** — `WaterSample.waterAlpha`
   (= `WaterRGBA.a / 255`) replaces the fixed `BASE_ALPHA`; final `alpha = mix(uWaterAlpha, 1, fres)`. High
   timecyc alpha (~0.95 by day) keeps the dark tint dominant instead of letting the background bleed through.

7. ✅ **Smooth transitions** — a weather change now eases over ~6s instead of switching instantly.
   - **`sampleTimecycBlend(timecyc, from, to, hour, t)`** (renderware): blends two weathers at an hour by
     lerping their flat rows (the same op `sampleTimecyc` uses for hours), so *every* timecyc field
     cross-fades — sky, fog, water, sun, lights, shadows all move together.
   - **`WeatherTransition`** (`game/weather/`, renderware-free): holds `from`/`to` indices + an eased `t`
     (smoothstep). `begin(weather, seconds)` starts a blend, `tick(delta)` advances it (ticked each frame
     in the game loop, real-time so it finishes even while paused), `blend()` is the snapshot the samplers
     read. Mid-transition retarget restarts from the nearest endpoint (small worst-case pop).
   - **Game**: `setWeather` `begin`s the transition over `config.weatherTransitionSeconds` (default 6;
     ≤0 = instant); the committed target updates immediately (`getWeather()` = `WeatherTransition.target`) so
     the debug tab highlights the new weather right away; new `getWeatherBlend()`. `loadGame` seeds the initial
     weather instantly (0s ease). canvas-host `skySample`/
     `waterSample` use `getWeatherBlend()` + `sampleTimecycBlend`, and lerp the cloud profile (coverage/
     darkness) between `from`/`to` by `t`.
   - Known seam: the vehicle-reflection sky probe refreshes on `configChanged` (once, at blend start) +
     periodically, so car reflections can show a slightly stale sky mid-blend — acceptable for a 6s ease.

## Files

- **New:** `src/game/plugins/cloud-profile.ts`, `src/game/weather/weather-transition.ts`;
  `.claude/plans/031-weather-manager.md`.
- **Changed:** `config.interface.ts` (+`weatherTransitionSeconds`; weather is *not* Config), `game.ts`
  (`loadGame({ weather })` seed, getter/setter, transition tick + blend, `broadcastConfigChanged`),
  `game/index.ts` exports, `renderware/parsers/text` (`WEATHER_NAMES` + `sampleTimecycBlend`),
  `sky.plugin.ts` (cloud profile + sun/light/shadow cloud coupling, `SkySample.cloudCover/cloudDark`),
  `water.plugin.ts` (`waterAlpha`, darken-only detail), `vehicle-reflection.plugin.ts` (probe refresh on
  configChanged), `canvas-host.tsx` (samplers blend from/to + WEATHERS list + debug actions + water
  reflection default), `debug-overlay.tsx` (Weather tab), 4 system-test fixtures.

## Verification

`npx tsc --noEmit`, `npx eslint src/`, `npx vitest run` (293 pass / 10 skip), `npm run build` — all clean.
In-browser: debug **Weather** tab — EXTRASUNNY ≈ clear sky + crisp sun/shadows; CLOUDY = full dark overcast,
no sun, no shadows, flat soft light; water plausibly deep across all weathers.

## Reserved for later (this plan can grow)

**Rain/storm** (precipitation + wet surfaces + lightning), tying weather to an in-game weather *schedule*
(auto-cycle) rather than only manual debug selection, true mid-transition blending (snapshot the blended
sample instead of restarting from the nearest endpoint), and `ambObj` per weather for peds/vehicles. Night
work (moon/stars, darker nights) stays tracked in [[029-graphics]]. (Smooth weather **transitions** — DONE,
phase 7; transition duration is `config.weatherTransitionSeconds`.)
