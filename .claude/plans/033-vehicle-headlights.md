# 033 — Vehicle headlights (night)

When the player drives at night, the occupied car's headlights turn on: the front-light **texture swaps to
its lit variant** and a real **spotlight** throws a forward-down cone onto the road. Reuses the night-hours
from [[032-night-and-lights]] (`config.graphics.lights.nightStartHour/EndHour`) — semantically the same "lamps
on" window. Status: **DONE (v1, rough)** — texture swap + two glow coronas + two spotlights at the model's
`headlights` dummy (±X), gated on `seated && game.isNight()`. Works, but **needs rework later** (see below).

## ⚠️ Known issues — rework later (user: "let's stop here for now")

The current v1 is functional but rough; the glow looks poor and the lights aren't handled per-lamp:
- **Marker + tail lights wrong.** We swap the whole shared `vehiclelights128 → vehiclelightson128`
  atlas, so *all* lights in it (head, tail, indicators, marker) switch "on" together — there's no
  per-lamp control, and non-headlight lights light up incorrectly / look bad.
- **Glow is crude.** A single radial sprite per side at the `headlights` dummy doesn't match the real lamp
  shape/position; the corona reads as a flat blob rather than a headlight.
- **No taillights/brake state**, no per-lamp colour (head = white, tail = red), no proper falloff.
- **Perf note (fixed):** the two always-on spotlights enlarge every world material's shader, which made the
  sun's dusk `castShadow` toggle recompile noticeably slow (a freeze at nightfall). Fixed in `SkyPlugin.
  updateShadow` by keeping `sun.castShadow` stable (config-only) and skipping the night shadow render via
  `shadow.autoUpdate` instead of toggling `castShadow`. Keep this in mind if the rework adds more lights.

**Likely better approach (rework):** parse the vehicle DFF's **2dfx light entries** (the same plugin we
already parse for street lamps — `geometry.lights`) for exact per-lamp positions/colours/types (head vs tail),
drive coronas + spotlights from those, and only "switch on" the lights the data marks, instead of swapping the
whole atlas. See [[vehicle-headlights-rework]] memory.

## How it should work (from the ask)

- Every car's front lights use the shared `vehiclelights128` texture (in `vehicle.txd`). There's a matching
  `vehiclelightson128` with the **same UVs** — the night/"lights on" version.
- A car carries a `lights: boolean`. Player enters a car → `lights = true` (gated to night, see below).
- When on: swap the headlight material's `map` `vehiclelights128 → vehiclelightson128`, **and** add a real
  light at the middle of the headlights, tilted so it falls forward onto the ground (real headlight glow).

## Current state (assessment — it fits cleanly)

- ✅ **Both textures already loaded.** `GtaSaWorldAdapter.loadGenericVehicleTextures()` parses `vehicle.txd`
  once and merges it into each car's texture map (`[...generic, ...carTxd]`), so `vehiclelights128` **and**
  `vehiclelightson128` are both present as `Texture`s — the swap is just reassigning `material.map`.
- ✅ **"Player in car X" is already known.** `EnterVehicleSystem` has `getActive(): EnterableVehicle | null`
  + a `phase` (`'seated'` = driving). `EnterableVehicle.object` is the renderable car.
- ✅ **Night window is config-driven.** `game.getHours()` + `inHourWindow(hour, on, off)` (`game/time/`) +
  `config.graphics.lights { nightStartHour: 20, nightEndHour: 6 }` — exactly what the ask wants to reuse.
- ✅ **Emissive-texture pattern exists.** Lit windows (`build-region`) already do `emissiveMap = map` so bright
  texels glow in the dark — we do the same on the headlight material so `vehiclelightson128` actually glows,
  not just shows a brighter texture under the dark night ambient.
- ✅ **Perf is bounded.** Only the **occupied** car gets a light → **one** `SpotLight`. (Contrast the deferred
  corona point-lights, which needed many — that's why those were skipped.)
- **Missing:** the headlight materials + the `vehiclelightson128` texture aren't surfaced out of `buildVehicle`;
  there's no per-car lights state, no spotlight, and no system to drive it.

## Design & phases

1. **Surface headlights from the build** (`build-vehicle.ts` → `VehicleModel`). While building vehicle
   materials, collect the materials whose diffuse map is `vehiclelights128` into
   `BuiltVehicle.headlightMaterials: MeshStandardMaterial[]`, and grab `textures.get('vehiclelightson128')`
   as `BuiltVehicle.lightsOnTexture: Texture | null`. Stash the original ("off") map on each material's
   `userData.lightsOffMap` so the toggle is reversible. Thread both through `VehicleModel` (adapter) →
   `SpawnedVehicle` / `EnterableVehicle` (so the lights system can reach them). Match the texture name
   case-insensitively (`map.name.toLowerCase() === 'vehiclelights128'`).

2. **Lights toggle** (a small helper / method on the built car, renderware-free). `setHeadlights(on)`:
   - swap each headlight material's `map` (`lightsOnTexture` ↔ `userData.lightsOffMap`),
   - set `emissiveMap = on ? lightsOnTexture : null`, `emissive = white`, `emissiveIntensity = HEADLIGHT_EMISSIVE`
     so the lit texels glow (pairs with bloom),
   - `material.needsUpdate = true` (swapping the map slot recompiles once),
   - show/hide the spotlight (phase 3).
   Idempotent (only touches state when `on` changes).

3. **Headlight spotlight** (one `SpotLight`, parented to the car `object` so it follows it). Positioned at the
   **front-centre** of the body (derived from `halfExtents` — front face, headlight height) and aimed
   **forward + slightly down** via a target, so the cone lands on the road ahead. Warm-white, modest range,
   soft penumbra. Created lazily for the occupied car only; intensity ramps with the same on/off as the
   texture. Tuned in-browser (position/angle/range/intensity constants, later promotable to config).

4. **`VehicleHeadlightSystem`** (`game/vehicle/`). Each frame: the on-state =
   `enterSystem.phase === 'seated'` **AND** `inHourWindow(hour, lights.nightStartHour, lights.nightEndHour)`
   **AND** `lights.enabled`. Apply `setHeadlights(on)` to the active car; ensure lights go **off on exit** (and
   on any car that stops being active). Wired in canvas-host with the `EnterVehicleSystem` + config + `getHours`.
   (Night-gated per the ask's reuse of the lights hours — headlights off in daytime even when seated, like SA.)
   The gate is **occupant-agnostic** (keyed on `seated`, not "is it Tommy"), so it **generalises to NPC
   traffic for free**: any occupied car gets night headlights with no extra logic — keep it that way.

## Night signal (note for the centralization)

Don't rename the generic `inHourWindow` to `isNight` — it's also used for **daytime** `tobj` windows
(`TimedObjectSystem`). When we want one source of truth for "is it night", add a thin wrapper, e.g.
`game.isNight()` = `inHourWindow(getHours, lights.nightStartHour, lights.nightEndHour)`, and route headlights /
coronas through it (the unified day/night state we discussed; separate from `SkyPlugin`'s sun-height `night`
factor for atmosphere/stars/moon). See [[night-signal-and-traffic-headlights]] memory.

## Config

Reuse `config.graphics.lights.nightStartHour/EndHour/enabled` for the on/off window (no new time config — the
ask said so). The **beam look** is now its own live config **`graphics.headlights`** = `{ angle (cone half-
angle → pool size), distance (reach), glow (lamp sprite size), intensity (strength) }` (`HeadlightConfig`),
applied each frame by `VehicleHeadlightSystem` (constant light count preserved — only spot params change).
`Game.setHeadlights` + debug **HEADLIGHT POWER / DISTANCE / CONE / GLOW** sliders. Colour/penumbra/decay stay
fixed constants. (Defaults: angle π/7, distance 35, glow 0.15, intensity 8.)

## Open decisions (confirm before building)

- **Spotlight position:** approximate from the body `halfExtents` (front-centre) — simple, good enough — **vs**
  the car DFF's **2dfx light** entries (we already parse `geometry.lights` for street lamps; vehicle headlights
  are the same plugin, authentic positions/colours) but that needs surfacing vehicle lights through
  `buildVehicle`. Recommend **halfExtents first**, 2dfx as a later refinement.
- **Spotlights:** went with **two** (one per lamp at the `headlights` dummy, mirrored ±X) — a single central
  light read as coming from the bonnet/grille; two clearly read as headlights. Authentic (SA mirrors the dummy).
- **Night-gated vs always-on-when-seated.** Recommend **night-gated** (uses the lights hours, matches SA and
  your suggestion).
- **Headlight beam visibility:** just the ground pool now; volumetric beam cones are a future extra.

## Files to touch

- `renderware/three/build-vehicle.ts` (+ `BuiltVehicle`): collect `headlightMaterials` + `lightsOnTexture`,
  stash off-map on userData.
- `game/interfaces/world-adapter.interface.ts` (`VehicleModel`), `gta-sa-world.adapter.ts`,
  `vehicle/vehicle-lod.system.ts` (`SpawnedVehicle`), `vehicle/enter-vehicle.system.ts` (`EnterableVehicle`):
  thread the headlight handles through.
- **New** `game/vehicle/vehicle-headlight.system.ts` (toggle + spotlight + night gating).
- `ui/canvas-host.tsx`: build the lights-on texture handle, register the system.

## Out of scope (later)
Taillights/brake lights as a separate state, volumetric beam cones, per-car 2dfx-accurate light positions,
headlight damage (broken lamp). **NPC/traffic headlights come for free** once traffic exists (the system keys
on occupancy, not the player) — just register their cars with the headlight system.
