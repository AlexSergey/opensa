# 035 — City zones (which city is the player in) + weather-by-zone

Identify which **city** the player is in — **Los Santos, San Fierro, Las Venturas**, or **Countryside**
(everything outside the cities) — as a queryable signal that updates as the player moves. This is the
prerequisite for **weather-by-zone**: each timecyc weather belongs to a city (its name suffix), and the active
weather should follow the player's city, **cross-fading** on enter/leave.

Status: **Phases 1–3 DONE.** Zone identifier (cities + **Desert**) shows in debug → Position (CITY: …); weather
follows the region keeping its type, cross-fading at the border. Full suite green (354 pass).

## Research (what's already here)

- **`static/data/map.zon`** (loaded before IPLs per `gta.dat:77`) defines the city boxes. Format under the
  `zone … end` block, one per line:
  `name, type, x1, y1, z1, x2, y2, z2, level, label` — e.g. `LA01, 3, 480.0, -3000.0, -500.0, 3000.0, -850.0,
  500.0, 1, UNUSED`. The **`level`** field is the city: **1 = Los Santos, 2 = San Fierro, 3 = Las Venturas**.
  `z1/z2` are ±500 (full height) → a **2D AABB test on (x, y)** suffices. Our file has 7 boxes covering the 3
  cities; anything in **no** box = Countryside. Boxes don't overlap across cities (same-city overlap is fine).
  (Sanity: the Ganton spawn `2502,-1714` is inside `LA01` → Los Santos. ✓)
- **Weather already carries the city** in its name suffix: `EXTRASUNNY_LA`, `SUNNY_SF`, `EXTRASUNNY_VEGAS`,
  `SUNNY_COUNTRYSIDE`, … (`WEATHER_NAMES`). So city → weather is a suffix match — no extra table.
- **Smooth weather change is already built:** `game.setWeather(i)` eases over `weatherTransitionSeconds` via
  `WeatherTransition` (`getWeatherBlend()` drives the sky/sun blend). So weather-by-zone = "call setWeather when
  the city changes" — the cross-fade is free.
- **Player position** is available as a `() => Vec3` getter (the streaming/LOD systems already take one, e.g.
  `character.viewOf` in canvas-host).

City token = the **weather suffix** so phase 2 is trivial: `type City = 'COUNTRYSIDE' | 'LA' | 'SF' | 'VEGAS'`
(level 1→LA, 2→SF, 3→VEGAS). Display labels: Los Santos / San Fierro / Las Venturas / Countryside.

## Phase 1 — the zone identifier (DONE)

**Layering note:** the lint boundary forbids `game/**` (except adapters) from importing `renderware`. So the
**raw file parse** stays in renderware (boxes with a numeric `level`), the **City domain** lives in the game
layer, and the **UI** maps level→city (UI may import both):

- **renderware** `parsers/text/zon.parser.ts`: `parseZones(text): MapZone[]`, `MapZone = { name, level, min:
  [x,y], max: [x,y] }` (normalise min/max; skip `zone`/`end`/comment/malformed). No City concept. Tested.
- **game** `zones/city.ts`: `type City = 'COUNTRYSIDE'|'LA'|'SF'|'VEGAS'`, `type CityBox = { city, min, max }`,
  `cityFromLevel(level)` (1→LA, 2→SF, 3→VEGAS, else null), `cityAt(x, y, boxes): City` (first box wins, else
  Countryside). Tested.
- **game** `zones/city-zone.system.ts`: `CityZoneSystem(boxes, position: () => Vec3, onChange)` — classifies
  each `update()`; fires `onChange` on change (incl. the first update). Tested (change-detection).
- **game** `game.ts`: `getCity()` + `setCity(city)` (emits `'city'` on change); `'city'` added to `GameEvents`.
  Re-exported from the game barrel (`City`, `CityBox`, `cityFromLevel`, `CityZoneSystem`).
- **UI** `canvas-host.tsx`: `loadCityBoxes(data/map.zon)` = `parseZones` + `cityFromLevel` → `CityBox[]` (absent/
  failed → `[]` → always Countryside, non-fatal); `new CityZoneSystem(boxes, character.viewOf, (c) =>
  game.setCity(c))`.
- **UI** debug **Position** tab: `CITY: <label>` (seeded from `getCity()`, live via the `'city'` event).

## Phase 2 — weather-by-zone (DONE)

**Keeps the current weather *type* across cities**, cross-fading at the border. `weatherForCity(weatherNames,
currentIndex, city)` (`game/weather/weather-zones.ts`, pure — names passed in) strips the region suffix to get
the type, then picks the first that exists:
1. `<type>_<city>` — the city's own variant;
2. `<type>_COUNTRYSIDE` — the type's Countryside variant → **RAINY stays RAINY anywhere** (LA/Vegas have no
   RAINY, so they take `RAINY_COUNTRYSIDE`; SF keeps `RAINY_SF`);
3. `SUNNY_<city>` — types with no analog → **SUNNY** (EXTRASUNNY_SMOG / SUNNY_SMOG, **FOGGY = SF-only**,
   **SANDSTORM = DESERT-only**).

Wired in `canvas-host`: the `CityZoneSystem` onChange does `game.setCity(c)` + `game.setWeather(weatherForCity(
WEATHER_NAMES, game.getWeather(), c))` → cross-fades over `weatherTransitionSeconds`. Tested in
`weather-zones.test.ts` (each anomaly). Unused weathers (UNDERWATER / EXTRACOLOURS_1/2 / SANDSTORM_DESERT) are
never targeted (only `<type>_<city>` / `<type>_COUNTRYSIDE` / `SUNNY_<city>` are produced).

**Open Qs (later):** manual debug weather is kept as the "type" and re-regioned on the next crossing (no special
override); no border **hysteresis** yet (standing on a boundary could re-trigger the cross-fade).

## Phase 3 — Desert region (DONE)

`map.zon` only has the 3 coarse city boxes (level 1/2/3) — no desert, and its Las Venturas box over-runs the
desert. The **desert** = two `info.zon` **county** zones (found by ranking zones by area): **`BONE`** (Bone
County, central) + **`ROBAD`** (Tierra Robada, NW). `info.zon`'s `level` field is useless here (always `1`), so
the desert is keyed by **zone name** (`isDesertZone` in `game/zones/city.ts`; `DESERT` added to `City`).

- UI loads both files: `loadCityBoxes(map.zon)` + `loadDesertBoxes(info.zon)`; passes **`[...desertBoxes,
  ...cityBoxes]`** so **desert is checked first** — it wins over the coarse Vegas box at its western edge (the
  `x≈869` Bone/Vegas border), while real Las Venturas (east of `x≈869`) still classifies as VEGAS.
- **Weather:** the desert only runs **clear** weather (SANDSTORM is **script-triggered**, not zone-driven):
  `weatherForCity(..., 'DESERT')` → `EXTRASUNNY_DESERT` if the current type is EXTRASUNNY, else `SUNNY_DESERT`
  (never SANDSTORM/cloudy/rainy). Tested.

## Out of scope

Info-zone names (Ganton/Idlewood — `info.zon`, the HUD area text), interiors, audio zones, sea/desert
sub-regions. Phase 1 is city-level only.
