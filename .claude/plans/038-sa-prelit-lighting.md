# 038 — SA prelit world lighting (unlit map + dynamic-only sun/shadows)

## Goal

Light the **static map the way SA's engine does**: an *unlit* pipeline where world
colour = `texture × blend(day prelit, night prelit) × timecyc tint`, with **no vertex-normal lighting, no
sun on buildings, no full-scene shadow map**. The sun (timecyc-driven directional) keeps lighting
only **dynamic objects** (vehicles, peds); shadows become **dynamic-casters-only**, projected onto
the unlit world. This is the planned lighting rework that retires today's "janky day lighting" (
memory `shadows-deferred`) and makes dirty-asset normals irrelevant for the map (plans 037/004 context).

## Why (recap of the analysis)

- SA's `CCustomBuildingDNPipeline` ignores vertex normals entirely: world shading is **baked** in
  two prelit sets (day + night, the `0x253F2F9` "extra colours" we already parse as
  `nightColors`),
  blended by a day/night balance, modulated by timecyc colours. Building shadows are baked; they
  do not move with the sun — that's the authentic SA look.
- Our current map is MeshStandard + dynamic sun + full-scene shadow map → harsh black/white
  days, shadow acne, and sensitivity to garbage normals in re-exported assets.
- Dynamics (vehicles/peds) are dynamically lit in SA too — that part of our engine stays.

## What we already have (infrastructure ~half done)

- `nightColors` parsed → `nightColor` attribute on map geometry (build-clump).
- Shared-uniform shader-injection pattern: `nightColorUniform` /
  `applyNightVertexEmissive`
  (becomes obsolete — subsumed by the real blend), `nightFillUniform` (dynamics —
  stays),
  `coronaMaterial`, `GLOW_LAYER` (SSAO prepass exclusion).
- Wall-clock fade `clockNightFactor` (memory `night-vertex-tonemap-clock`) — becomes the *
  *single
  dnBalance** driver (lit windows + tonemap already ride it).
- timecyc `amb`/`ambObj` per weather/hour (+ `sampleTimecycBlend`); SkyPlugin sun direction/colours.

## Design

### 1. SA world material (`renderware/three/world-material.ts`)

One shared-program unlit material for all instanced map parts (replaces `buildMaterial` on the
map
path only — vehicles/peds keep the lit path):

```
colour = texture(map, uv)                        // forced-white slot stays white when untextured
       × mix(dayPrelit, nightPrelit, uDnBalance) // per-vertex; no nightColors → dayPrelit both ways
       × uWorldTint                              // global timecyc tint (see §2)
```


- Same param parity as `buildMaterial`: alphaTest/transparent from texture alpha, DoubleSide
  for transparent + the IDE `0x200000` flag (plan 004), vertexColors required (no prelit → white).
- **Normals stay in the geometry** (sanitize from plan 037 stays): SSAO's NormalPass and
  future
  needs still consume them — the world material just doesn't light by them.
- Night-lit **timed window overlays** (build-region `WINDOW_EMISSIVE`) keep their additive
  emissive
  term in this shader (they must glow over the blend, exactly like today).

### 2. Day/night driving (uniform holders in renderware, driven by the game)

- `uDnBalance` = `clockNightFactor(hours)` — the one clock all night visuals already use.
- `uWorldTint` = timecyc-derived global tint so models **without** night prelit (most LODs!)
  still darken at night: day → ~white, night → derived from timecyc `amb` for the active
  weather/hour (exact mapping is a calibration knob, start `mix(1.0, amb×k, uDnBalance)`).
- Driven per-frame from canvas-host next to the existing nightColor/nightFill/corona uniform updates.

### 3. Sun + lights (mostly automatic)

- Map goes unlit ⇒ Ambient/Hemisphere/Directional **stop affecting it by construction**; they
  keep lighting dynamics (vehicles/peds) — recalibrate their intensities for dynamics-only (
  AMBIENT_DAY etc. in SkyPlugin were tuned against the lit map).
- Sun disc/god-rays/sky dome/fog/water: untouched.
- Dynamics keep night-fill (plan 034); the **map's** night look now comes from the real prelit blend.

### 4. Shadows — dynamic casters only (T2)

- All instanced map meshes: `castShadow = false` (`receiveShadow` irrelevant — unlit). The
  sun shadow map then contains **only vehicles + peds** → frustum shrinks to a small radius around
  the view → far sharper shadows, no acne on buildings, big perf win.
- The world material **receives**: inject the directional-shadow sampling term (three
  shadowmap chunks) into the unlit shader so cars/peds cast onto roads. Buildings cast nothing —
  authentic (their shadows are baked into the ground prelit by Rockstar).
- Optional fallback (config): cheap blob decal under entities (SA's actual CShadows look) for
  weak GPUs — only if T2's chunk-injection fights us; not built up front.

### 5. Mode switch (A/B during calibration)

`Config.graphics.worldLighting: 'dynamic' | 'sa-prelit'` (+ debug-overlay toggle,
like `geometry: lods|map`). The old path stays intact until the new look is signed off in
all weathers/hours; then the old map-lighting branches (`applyNightVertexEmissive`, map share
of night-fill assumptions, full-scene shadow config) are deleted.

## Iterations (each keeps `npm test` + the app green)

1. **World material core.** `world-material.ts` (uniform holders + builder), wired
   behind
   `worldLighting: 'sa-prelit'` through `buildClumpParts`/`build-region` (RenderPart.material
   type
   widens). Day prelit × texture × tint; night blend where `nightColors` exist;
   timed-window
   emissive parity; IDE double-side + alpha parity. Tests: synthetic geometry (blend math,
   no-night
   fallback, tint) + real fixtures (casroyale, trafficlight cases reuse).
2. **Uniform driving + mode switch.** Config + debug toggle; canvas-host drives
   `uDnBalance`/
   `uWorldTint` (timecyc amb of active weather); A/B in browser across hours/weathers.
   SkyPlugin
   intensities recalibrated for dynamics-only.
3. **Dynamic-only shadows.** Map `castShadow = false`; shadow frustum shrunk (config);
   shadow-receive
   term injected into the world material; verify car/ped ground shadows + no building shadows.
4. **Calibration + cleanup.** Tune `uWorldTint` mapping/ACES/bloom/night-fill against
   reference screenshots per weather/hour; delete the old map-lighting path +
   `applyNightVertexEmissive`; update plans/memories (`shadows-deferred`, `night-vertex-tonemap-clock`,
   `night-grade-calibration`, plan 032/034 notes).

## Risks / open questions

- **The big cost is calibration**, not code: every weather/hour was tuned against the lit
  map (ACES, bloom, night-fill, sky). Expect an iterative pass with in-browser screenshots.
- Models lacking prelit entirely (rare) render `texture × tint` — acceptable; verify on the
  debug full-map sweep.
- Moving building shadows are **gone by design** (SA-authentic). If ever wanted, that's a
  separate "modern lighting" fork (T3), not this plan.
- SSAO interplay: AO now multiplies onto unlit colour — likely reads *more* SA-PS2-plus than
  now; `luminanceInfluence` may need a touch-up.

## Out of scope

Interior lighting, `ambObj`-driven ped/vehicle ambient accuracy, weather transitions,
procedural
shadows (CShadows blobs) unless T2 fails, the modern-lighting fork (T3).

## STATUS: DONE (2026-06-10) — shipped as the ONLY map pipeline

All four iterations landed in one session; the old `dynamic` lit-map path was then **deleted
**
(user call) — `worldLighting` mode/`?lighting=` URL switch,
`night-vertex-colors.ts`
(`nightColorUniform` + `applyNightVertexEmissive`), the map's standard-material branch,
full-scene
shadow casting, and PostFx's tonemap clock-fade are all gone. Final architecture:

- **`world-material.ts`** — unlit `MeshBasicMaterial` + injections: `texture × mix(day, night
    prelit, uDnBalance) × tint`, manual 4-tap PCF shadow receive (`worldShadowUniforms`),
  additive
  `windowGlow` for timed overlays. Two program variants (`saWorld`, `saWorld|night`);
  night-prelit
  models ride `worldDayTintUniform` (relaxes to the night-prelit level — never the dark
  ambient,
  which double-darkens), no-night models (LODs) ride `worldTintUniform` → timecyc `amb`.
- **Clocks**: dnBalance = `clockNightFactor(night.litFade)`; the tints add a **sun-height day arc
  **
  (noon peak → warm horizon dim). ACES tonemap is **always on** (opacity 1).
- **Shadows**: only dynamics cast; `SHADOW_SIZE = 45` tight frustum; receive strength gated
  by
  `shadow.autoUpdate` (a frozen night map pointed dawn shadows at yesterday's sunset) and
  faded
  `(1 − nightFactor)²` (low-sun mega-long shadows dissolve). `?shadowdebug=1` paints the term
  red +
  draws the frustum helper — NB it shows **coverage, not strength**.
- **Calibration**: `graphics.worldLight` config (dayBrightness 0.85, duskBrightness
  0.45,
  nightPrelitBrightness 0.7, lodNightAmbScale 1.6, shadowStrength 0.55) — live sliders in
  debug →
  Atmosphere; fixed hues stay in canvas-host (`WORLD_DAWN_HUE`, `WORLD_NIGHT_PRELIT_HUE`).
- Memories updated: `shadows-deferred` (RESOLVED), `night-vertex-tonemap-clock` (new signal map).
