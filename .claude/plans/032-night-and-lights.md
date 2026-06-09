# 032 — Night & light sources (tobj gating, 2dfx coronas, lit windows, stars)

Make **evening/night** look right: timed objects appear/disappear at their time-of-day, street lamps and
other lights switch on after dusk (configurable, default 20:00), lit windows glow, and the night sky gets
**stars**. Extends [[029-graphics]] (night was reserved there) and reuses the [[031-weather-manager]] sky/
timecyc plumbing. **Goal stays: best picture, least cost.**
Status: **phases 1–9 DONE** (tobj gating, dark nights, stars, 2dfx coronas, lit windows, moon, night
atmosphere = skylight + colour grade, **ground light pools** under lamps) + **corona occlusion polish DONE**.
Optional left for later: real **point lights** under coronas (perf-sensitive — user deferred in favour of the
cheaper SA-style light-pool splat), corona texture variety. The **night grade mask / magic numbers need
recalibration as other light sources land** — see phase 8's ⚠️ calibration note.

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
   dusk/dawn cross-fade). The night ambient **brightness** (moonlight floor) + cool **tint** (lerped white→tint
   by `night`) make evenings dark + moody; world meshes are `MeshStandardMaterial` lit by this ambient (no
   per-material prelit shader needed). The same `night` drives the stars. Tunable via
   **`Config.graphics.night { brightness, tint }`** + `Game.setNight` + debug **NIGHT BRIGHTNESS / TINT R/G/B**
   sliders (was the hardcoded `AMBIENT_NIGHT` / `NIGHT_TINT` consts).

3. ✅ **2dfx light parsing — DONE.** Added `RwSection.TWO_D_EFFECT` (`0x253F2F8`); `dff.ts` parses the
   geometry 2d-effect plugin's **Light** entries (type 0) into `RWGeometry.lights: RWLight2d[]` (position,
   RGBA, corona size, far-clip, corona texture, flags1), skipping non-light entries by their `dataSize`.
   **Byte layout verified against real lamp DFFs** (`mlamppost`, `streetlamp2`, `lamppost2`, `vegaslampost2`,
   `chinalamp_sf`) — lights sit atop the posts with sane warm/white colours, `coronastar`, sizes 1–4,
   far-clips 62–300. Synthetic-chunk unit tests cover light parse + non-light skip + no-effect.

4. ✅ **Corona rendering — DONE (sprites; point lights deferred).** `renderware/three/corona.ts` owns a
   **shared additive `ShaderMaterial`** (`coronaMaterial`) + `buildCoronaPoints(entries)` → one `Points`
   glow cloud per cell. `build-clump.buildClumpLights(clump)` extracts a model's lights in clump-local space
   (frame applied); `build-region.collectCoronas` places them by every instance transform (world Z-up);
   `build-cell` appends the `Points` to **HD** cells (streams in/out with the cell). The shader sizes points
   perspective-correctly (`proj[1][1] · viewportHeight / dist`, clamped) with a soft radial glow, per-point
   colour, and a far-clip fade; a corona render `Config.graphics.lights { enabled, nightStartHour=20,
   nightEndHour=6 }` drives a tiny canvas-host system that eases the shared `uOn` on/off around the night
   hours (+ updates `uViewportHeight`). Debug **Night lights (lamps)** toggle + `Game.setLights`. Hour-window
   logic shared with the timed objects via `game/time/hour-window.ts`.
   ✅ **Occlusion (polish) — DONE.** Coronas are **depth-tested** (buildings occlude them, no shine-through),
   and self-occlusion by a lamp's own head is solved by a small **toward-camera depth nudge** in the vertex
   shader (`mv.z += 3.0`): a centred post light (e.g. `Streetlamp1`, light at x≈0/z=2.74) clears its housing
   while world geometry farther in front still occludes the glow. (Replaced the earlier `depthTest:false`.)
   - **Deferred (try later):** real **point lights for nearby coronas** so the ground/walls catch warm light.
     Sketch: store each cell's `CoronaEntry[]` on the `Points` `userData`; a small pool (~6) of `PointLight`s
     under the streaming root follows the **nearest** coronas to the camera each frame (camera in GTA space via
     `streamingRoot.worldToLocal`), colour/intensity × `uOn`, distance-culled. **Perf-sensitive** (adds
     per-fragment light cost to every world material), so make it **config-toggled + off by default** (only
     add the lights to the scene when enabled, to stay zero-cost off). User chose to **skip for now**.
   - **Deferred:** corona texture variety (`coronastar` look is baked into the shader for now),
     particle/other 2dfx entry types.

5. ✅ **Lit windows / emissive night — DONE.** Night-lit timed variants (windows `[on, off)` that wrap
   midnight, e.g. `20→6`) get their materials made **self-illuminated** in `build-region`:
   `emissiveMap = the diffuse map`, `emissive = white`, `emissiveIntensity = 1.2`. So the bright window
   texels glow in the dark while dark texels stay dark — no per-window data needed. They only render at
   night (phase-1 gating), so no daytime toggle is required; pairs with bloom (plan 029). Daytime `[6,20)`
   timed variants are left matte.
   - **DECISION — vanilla-accurate only (no mod-style window lighting).** Researched the authentic SA
     mechanism: lit windows are **separate night tobj overlay models + textures** (`nitelites*`,
     `nightlights*`, `LTSLAsky/build*`, `lanitewin*`), i.e. model/texture swapping — *not* dynamic per-window
     lighting on the base building. We reproduce exactly that (emissive on night tobj), so buildings WITH a
     nearby overlay glow (e.g. `LongBeBlok1_LAe` ← `nitelites_LAE2` 30u away) and buildings WITHOUT one stay
     dark in vanilla (e.g. `mcstraps_LAe2` in Grove St — no overlay, no 2dfx, nearest overlay 168u away).
     This matches the original game (lit windows = downtown/commercial; residential hoods are dark). We
     **deliberately do not** add the heuristic "emissive any material whose texture name looks like a window
     (`*windo*`/`*win*`/`gangwin*`/`*curt*`)" — that's what the *night-windows mods* (IWNL, Proper Night
     Windows, LS Downtown Night Windows) do, and it's non-vanilla. If we ever want denser nights it'd be an
     opt-in toggle, but the project choice is vanilla fidelity. See [[gta-sa-lit-windows-vanilla]] memory.

6. ✅ **Stars — DONE.** A procedural hash star field in the dome fragment shader (`starField()`): a gnomonic
   projection of the view direction tiled into cells, ~one star per lit cell with random brightness + gentle
   `uTime` twinkle, tapering toward the horizon. Added **before** the cloud blend so overcast hides them, gated
   by `uNight` (sun height) + a `uStars` master toggle. No extra geometry/draw call; inherits the dome's
   camera-follow + probe layer. `Config.graphics.stars { enabled }` + **Night stars** debug checkbox + setter.
   (Richer point-cloud version remains a future option.)

7. ✅ **Moon — DONE (static, `coronamoon`).** A **static additive Sprite** in `SkyPlugin` at a fixed sky
   direction (`MOON_DIR`), using the SA **`coronamoon`** texture from `particle.txd` (alpha-shaped; canvas-host
   loads it via a small `loadTxd` helper and passes it to the plugin — falls back to a soft radial glow if it
   can't load). It simply **fades in** as night falls: opacity = `night × cloudFade` (heavy overcast hides it),
   depth-tested so geometry occludes it, on the reflection-probe layer. (Earlier arc-across-the-sky +
   procedural cratered disc + glow halo were replaced per the request for a simple static moon.)
   **`Config.graphics.moon { size, brightness }`** + `Game.setMoon` + debug **MOON SIZE / BRIGHTNESS** sliders
   (`MOON_DISTANCE` stays a const).

8. ✅ **Night atmosphere (skylight + colour grade) — DONE.** Two additions to make the dark night read as
   *alive* and *night-coloured*, not just "darker day":
   - **Skylight** — a `HemisphereLight` in `SkyPlugin` (sky colour from above, dark ground below), intensity
     `night × night.skylight`, giving objects top-down form the flat ambient can't. (NB: a structural plugin
     change — needs a full reload, not HMR, to take effect.)
   - **Night colour grade** — a screen-space `NightGradeEffect` (`game/plugins/night-grade.effect.ts`), a
     `postprocessing` `Effect` added as a pass in `PostFxPlugin` **after tone mapping, before SMAA**. Driven by
     the same sun-height night factor (stashed on the shared `godraysSource.userData.night` by `SkyPlugin`,
     read by `PostFxPlugin` — no new wiring), it (1) desaturates, (2) cool-multiplies toward `night.tint`,
     (3) lifts blacks to a faint tinted floor (moonlit blue, not dead black). **Brightness-masked** so bright
     sources (lamps, lit windows, coronas) keep their warm colour: `strength = uNight·(1 − smoothstep(0.5,
     0.9, luma))`. The shadow floor rides the raw night factor (only ever lifts darks → never touches sources).
     Pass disabled when `night ≈ 0` (zero cost by day). `Config.graphics.night.grade` (default 0.7) + debug
     **NIGHT GRADE** slider; reuses the **NIGHT TINT R/G/B** sliders as the grade colour.

   ### ⚠️ Needs calibration (revisit as other light sources land)
   The grade's magic numbers are tuned against the *current* set of night light sources and will likely need
   re-tuning when that set changes — keep them in mind when adding/altering night lighting:
   - **Brightness mask `smoothstep(0.5, 0.9, luma)`** decides what counts as a "warm source" that escapes the
     cool grade. It's calibrated to the present lamp coronas / lit-window emissive / headlight glow brightness.
     **New or brighter/dimmer emissive sources** (vehicle taillights, neon/signs, the deferred corona **point
     lights**, brighter window emissive, traffic-light glow) may fall on the wrong side of the threshold —
     dim warm lights getting cooled, or bright cool surfaces wrongly kept. Re-check the 0.5/0.9 band then.
   - **Desaturation `0.35`, cool-multiply via `night.tint`, shadow floor `0.06`** are tuned to look right at
     `night.grade = 0.7` with the current ambient floor (`night.brightness`) + **skylight**. If the skylight
     or ambient floor change a lot, the grade may read too strong/weak — rebalance grade vs ambient together
     (they interact: ambient/skylight add light, the grade removes colour + cools it).
   - **Interaction with bloom/tone mapping:** the grade runs after bloom + (optional) tone mapping. If bloom
     threshold/intensity or tone mapping change, the post-bloom luma the mask keys on shifts → re-check the
     mask band. Tone mapping is currently **off** by default; turning it on will compress highlights and move
     the mask threshold.
   - User is hand-tuning the slider values now; treat the committed defaults as a starting point, not final.

9. ✅ **Ground light pools under lamps — DONE (SA "light shadow", not real lights).** Lamps now leave a
   visible pool of light on the road at night. **How SA does it:** no dynamic lights for street lamps — each
   2dfx Light carries a corona **and** a projected "light shadow" splat (a flat textured blob, e.g. `shad_exp`)
   that `CShadows` lays on the ground. We mirror that cheaply: `renderware/three/light-pool.ts` —
   `buildLightPools(entries)` builds one flat additive **quad** per lamp on the GTA XY plane (soft radial
   falloff computed in-shader, no texture), sharing a `lightPoolMaterial` (additive, `depthWrite:false`,
   depth-tested so walls occlude it). `collectCoronas` became **`collectLights`** → returns `{ coronas, pools }`
   in one pass under the bulb (light X/Y). **Ground Z is found by a real raycast** at runtime, not guessed: the
   pool is built at a first-guess Z (`instance.z + clumpFloorZ`, the model's lowest point via `clumpFloorZ` in
   build-clump) so it shows immediately, then **`LightPoolSystem`** (`game/streaming/light-pool.system.ts`) rays
   the static collision via `PhysicsWorld.groundZBelow` and re-seats the quad on the hit. This is required
   because the model foot ≠ ground — a lamp can stand on a **curb**, leaving the foot floating above the road.
   The ray searches a **small window around the foot estimate** (`SEARCH_UP=0.3` / `SEARCH_DOWN=8`, mostly
   downward), *not* far down from the bulb: an earlier 50 m bulb-down ray could punch through a missing-
   collision gap onto a much lower surface and bury the pool underground **permanently** (`done=true`), so
   pools vanished for good as you drove. `SEARCH_UP` is kept tiny because a light directly over the post (e.g.
   `lamppost2`'s pale **centre** lamp — it has 3 lights: two offset orange arms + one central) **self-hits the
   post's own collision** at the ray start; a larger up-margin lifted that pool off the ground onto the post
   (looked like a stray glow at the lamp, not a ground splat). Failing to find ground (collision not loaded)
   leaves the pool at the visible estimate. Deferred + retried (the collision under a freshly
   streamed cell may not be loaded yet), budgeted (`PER_TICK` rays / 0.25 s sweep), and once a mesh's pools are
   all dropped it clears `userData.lightPools` so it stops being scanned (and stays put if the cached cell
   re-streams). The pool mesh exposes a `drop(index, z)` closure on `userData` so the game layer never imports
   renderware (respects the layer boundary). HD cells only; gated by the same night on/off as coronas, scaled
   by `night.lampPool` (debug **NIGHT LAMP POOL** slider, default 0.6). Pool **radius** is a live shader uniform
   `uRadius` (quads bake unit corners + an `aCorner` attribute, scaled in the vertex shader) → `night.
   lampPoolRadius` (debug **NIGHT LAMP RADIUS** slider, default 4.5) tunes it without rebuilding cells. Pools
   fade by **only** the global `uDrawDistance` (= `coronaDrawDistance`), *not* the per-lamp corona far-clip —
   that far-clip is authored short for the bright point sprite, so keying the pool to it made some lamps'
   ground pools vanish early while others persisted (raise `coronaDrawDistance` to push coronas + pools out).
   - **Limitations / later:** the dropped Z is a single value for the whole quad, so on a **steep slope** the
     flat pool still won't hug the grade across its radius. The downward ray could **self-hit** a lamp that has
     its own thin collider (→ pool stays near the foot guess); rare for street lamps. Pool is a flat quad (no
     soft-particle depth fade), so a steep camera angle shows a hard edge where it meets a wall. Real budgeted
     **point lights** remain the deferred higher-fidelity option. The night grade may cool the warm pool
     slightly (mask keys on luma).
   - **Traffic lights temporarily suppressed.** `SUPPRESS_LIGHT_MODELS = /traffic/i` in `build-region` skips
     **all** 2d-effect lights (coronas + pools) for traffic-light models (`trafficlight1`, `cj_traffic_light*`,
     `gay_traffic_light`, `mtraffic*`) — we don't sequence them, so every bulb lit at once + cast odd pools.
     **Re-enable** (drop/relax the filter) once traffic-light cycling exists; then only the active phase's bulb
     should light. Street lamps don't match `traffic`, so they're unaffected.

## Config additions

- `Config.graphics.lights` (new): `{ enabled, nightStartHour, nightEndHour }` — when lamps/coronas switch on
  (default **20:00 → ~06:00**, configurable per the ask), master toggle, plus maybe a corona intensity/budget.
- `Config.graphics.stars` (new): `{ enabled }` (+ density later). Debug toggles in the Graphics/Weather tab.
- `Config.graphics.night` (new): `{ brightness, coronaDrawDistance, grade, lampPool, skylight, tint }` — the
  night atmosphere knobs (ambient floor, corona cap, **colour-grade strength**, **ground light-pool strength**,
  hemisphere skylight, cool tint). `grade` drives phase 8's `NightGradeEffect`; `lampPool` (default 0.6) scales
  phase 9's ground pools; `tint` is shared by the ambient *and* the grade.
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
