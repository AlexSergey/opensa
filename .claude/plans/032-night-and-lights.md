# 032 — Night & light sources (tobj gating, 2dfx coronas, lit windows, stars)

Make **evening/night** look right: timed objects appear/disappear at their time-of-day, street lamps and
other lights switch on after dusk (configurable, default 20:00), lit windows glow, and the night sky gets
**stars**. Extends [[029-graphics]] (night was reserved there) and reuses the [[031-weather-manager]] sky/
timecyc plumbing. **Goal stays: best picture, least cost.**
Status: **TOBJ gating + dark nights + stars DONE** (phases 1–2, 6); **2dfx coronas / lit windows / moon remain** (phases 3–5, 7).

## Current state (what the research found)

- **TOBJ are NOT rendered today** (not "always shown", as we assumed). `parseTimedObjects` reads the `tobj`
  IDE section but **strips the trailing `timeOn,timeOff`** and drops the defs into `MapDefinitions.timedCatalog`
  — which **nothing consumes**: `buildWorldGrid`/`build-cell` only read `defs.catalog`, so any instance whose
  id is only a `tobj` is **skipped** (no catalog def → `continue`). So at all hours we're *missing* the timed
  models (lit-window variants, some signage, etc.). The `ide.parser` even has a stale `TODO: render
  time-of-day objects … (see memory)` — that memory no longer exists.
- **2dfx are NOT parsed at all.** The DFF parser reads material effects (env-map/reflection/specular plugins)
  but never the geometry **"2d Effect" plugin** (`0x253F2F8`), which is where SA stores per-model **light**
  effects (corona + point light), particles, ped attractors, etc. So we have **no corona/lamp data**.
- **Night isn't dark.** `SkyPlugin` already fades the sun/ambient by sun height (night ambient floor 0.35,
  sun off below horizon) and timecyc gives night colours — but **prelit vertex colours bake daytime light**
  into the geometry, so buildings stay lit at night (noted in [[029-graphics]] phase 2).
- **No stars, no moon.** Sky dome is gradient + clouds only.
- **Time + timecyc exist** (plans 026/028): `game.getHours()`, `sampleTimecycBlend`, per-hour interpolation —
  everything time-driven can hook into these. Streaming builds **instanced** meshes per grid cell.

## GTA SA spec primer (the parts we need)

### Timed objects (`tobj`)
IDE `tobj` row = `objs` columns **+ `timeOn, timeOff`** (integer hours). The object is drawn only while the
game hour is in the window: `timeOn ≤ h < timeOff`, or — when it wraps midnight (`timeOn > timeOff`, e.g.
`20 6`) — `h ≥ timeOn || h < timeOff`. Night-lit building variants are typically `tobj 20→6`; their daytime
counterparts are plain `objs`/`tobj 6→20` at the same spot, so the world swaps model as time passes.

### 2d effects (`2dfx`) — the **Light** type
Stored in the DFF **geometry** Extension as the 2d Effect plugin (`0x253F2F8`): a count, then entries each
with `position(3×f32)`, `color(RGBA u8)`, `entryType(u32)`, and a per-type payload. **Type 0 = Light**:
corona far-clip, point-light range, corona size, shadow size, "show mode", flags (incl. **on-at-night /
flicker / only-from-below**), corona texture name + shadow texture name (`coronastar`, `shad_exp`, …),
flare type, etc. (Exact byte layout to be decoded against real DFFs, like the original DFF plan did.) These
are streetlights, building lights, neon, traffic lights — the things that "switch on" at night.

### Coronas
A light renders as a camera-facing **additive sprite** (the corona/flare texture from `particle.txd`) whose
size/brightness fade with distance and view angle and that is **occlusion-tested** (hidden when geometry is
between it and the camera). Optionally it also drives a real **point light** (small radius) for nearby
surfaces. Most are night-only (flag), some always-on.

### Night ambient
timecyc night rows give dark-blue `amb`/`dir` and low `dirMult`; the world should read dark so the coronas/
lit windows pop. Our blocker is the **prelit** day-bake.

## Architecture & phases

1. ✅ **TOBJ time-gating — DONE.** `IdeObjectDef` gained an optional `time { on, off }`; `parseTimedObjects`
   now **captures** the trailing `timeOn,timeOff` (was stripped). `buildWorldGrid` + `cellGroups` fall back to
   `defs.timedCatalog`, so timed instances **build** (they were silently dropped before). `build-region` tags
   each timed `InstancedMesh` `userData.timed = { on, off }` and starts it **hidden** (no wrong-time flash). A
   new **`TimedObjectSystem`** (`game/time/`, renderware-free) walks the streaming root each frame and sets
   `.visible` from `inWindow(hour, on, off)` (wraps midnight) — cheap, and gates freshly streamed cells
   immediately. Wired in canvas-host after streaming; unit-tested. No config (uses `game.getHours()`).

2. ✅ **Dark nights — DONE.** In `SkyPlugin`: a `night` factor `1 - smoothstep(sunHeight, 0, 0.22)` (smooth
   dusk/dawn cross-fade). Night ambient lowered (`AMBIENT_NIGHT 0.35 → 0.16`) and the ambient **colour** lerps
   white→cool blue (`NIGHT_TINT`) by `night`, so evenings go dark + moody (world meshes are `MeshStandardMaterial`,
   lit by this ambient — no per-material prelit shader needed after all). The same `night` drives the stars.

3. **2dfx light parsing** (renderware). Add `0x253F2F8` to `RwSection`; parse the geometry 2d-effect plugin in
   `dff.ts` into a typed model data: `RWLight { position, color, coronaSize, range, coronaTex, shadowTex,
   flags … }[]` on the geometry/clump. **Decode the exact layout against a known lamp DFF** (e.g. a
   `streetlamp`/`lamppost`) + unit test, mirroring the original DFF plan's verification. Non-light entry types
   are skipped (extension point).

4. **Corona / light rendering** (a `LightsPlugin` or system). For each placed instance that carries lights,
   spawn camera-facing additive corona sprites at `instanceMatrix · localPos` (texture from `particle.txd`),
   **night-gated** by flag + sun-below-horizon, **distance-faded**, and **occlusion-tested** (depth compare /
   raycast against the streamed cell, budgeted). Optionally a pooled set of real point lights for the **N
   nearest** coronas (cheap, capped) so nearby walls/road catch light. Lives alongside streaming so coronas
   load/unload with their cell; hard cap + distance cull for cost.
   - Reuse: the sun corona sprite/`radialTexture` pattern already in `sky.plugin.ts`.

5. **Lit windows / emissive night**. Where the night model is a lit-texture variant (phase 1 already swaps it
   in at night), make it actually **glow**: treat its emissive from the lit texture (or a flat emissive boost),
   gated by night, so it's visible in the dark and reads as interior light. Pairs with bloom (plan 029).

6. ✅ **Stars — DONE.** A procedural hash star field in the dome fragment shader (`starField()`): a gnomonic
   projection of the view direction tiled into cells, ~one star per lit cell with random brightness + gentle
   `uTime` twinkle, tapering toward the horizon. Added **before** the cloud blend so overcast hides them, gated
   by `uNight` (sun height) + a `uStars` master toggle. No extra geometry/draw call; inherits the dome's
   camera-follow + probe layer. `Config.graphics.stars { enabled }` + **Night stars** debug checkbox + setter.
   (Richer point-cloud version remains a future option.)

7. **(Optional) Moon** — a timecyc-coloured billboard opposite the sun arc at night (mirrors the sun disc in
   `sky.plugin.ts`), maybe phased. Low priority; behind stars.

## Config additions

- `Config.graphics.lights` (new): `{ enabled, nightStartHour, nightEndHour }` — when lamps/coronas switch on
  (default **20:00 → ~06:00**, configurable per the ask), master toggle, plus maybe a corona intensity/budget.
- `Config.graphics.stars` (new): `{ enabled }` (+ density later). Debug toggles in the Graphics/Weather tab.
- (Night darkness in phase 2 can ride the existing sun model; expose a strength const, promote to config only
  if needed.)

## What's missing (net new work, biggest first)

1. **2dfx parsing** — brand-new DFF decode path (exact light layout to reverse against real files). *Highest
   risk / unknowns.*
2. **Corona+light render system** with night-gating, distance/occlusion culling, and a point-light budget —
   new subsystem tied into streaming; the main perf concern.
3. **TOBJ gating end-to-end** — parser keeps times, catalog merge, tagged instanced groups, toggling system.
4. **Prelit night modulation** — shader/material change touching every world material; tune carefully.
5. **Stars** — small, self-contained dome-shader add.
6. **Emissive lit windows**, **moon** — incremental.

## Performance strategy

Toggle timed groups only on hour change (not per frame). Coronas: hard cap + distance cull + only spawn for
in-view cells; point lights limited to the few nearest (or none on low-end). Stars are zero extra cost
(in-shader). Everything night-gated so daytime pays nothing. All new effects toggleable (plain path when off),
consistent with [[029-graphics]].

## Open decisions (confirm before building)

- **Scope/order:** recommend **TOBJ gating → dark nights → stars** first (high visual payoff, low risk), then
  the **2dfx corona system** (the big one). OK to split 2dfx into its own follow-up plan if it grows.
- **2dfx source:** parse from **DFF** geometry plugin (authentic, per-model) — confirmed over the sparse IDE
  `2dfx` section.
- **Point lights at night:** real (budgeted) three point lights for nearby coronas vs corona sprites only
  (cheapest). Lean: a small capped pool, off-able.
- **Stars:** in-dome procedural shader (recommended, cheapest) vs a real additive point cloud (drei-style).

## Sources (stars research)

- [Starry Shader for Sky Sphere — three.js forum](https://discourse.threejs.org/t/starry-shader-for-sky-sphere/7578)
- [Complete Sky System for Three.js (sun/moon, day-night, stars) — three.js forum](https://discourse.threejs.org/t/complete-sky-system-for-three-js-skybox-sun-moon-day-night-cycle-clouds-stars-lensflares/88311)
- [3D Starry Night with Three.js — Kelly Lougheed](https://kellylougheed.medium.com/3d-starry-night-with-three-js-7f9191bbcb84)
- [Random starfield generator for THREE.js — Andreas Rohner](https://andreasrohner.at/posts/Web%20Development/JavaScript/Random-starfield-generator-for-THREE-js/)
