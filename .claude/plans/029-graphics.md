# 029 — Graphics (base plan): sky + sun (+ godrays)

A living plan — we extend it as graphics grows. **Goal: the best picture for the least cost** (smooth in
the browser). This iteration: **sky + sun** driven by timecyc, **EXTRASUNNY_LA only** (no other weather
yet); godrays as the final, optional step.

## Principles

- **Timecyc-driven, time-of-day everything.** Sky, lights and fog all come from
  `sampleTimecyc(EXTRASUNNY_LA, game.getTime() / 60)` (plan 028) each frame — no hand-picked colours.
- **Cheap by default.** One sky mesh; 1 ambient + 1 directional light (no shadows yet); fog is free;
  post-FX only where it pays, at reduced resolution, toggleable. Cap pixel ratio (already done). Keep
  draw distance bounded by fog/streaming.
- **DOM HUD/debug stay outside post-processing** (already true — they're DOM).
- **Layering:** graphics consumers read the renderware `Timecyc` in the `ui`/adapter layer or via a
  plugin constructed with it; the generic `game/**` stays free of GTA specifics.

## Architecture

- **`SkyPlugin`** (a `Plugin`, `game/plugins/sky.plugin.ts`) — owns the sky dome, the sun sprite, the
  sun-tracking **directional** light, the **ambient** light, and drives **fog colour**. Constructed with
  the loaded `Timecyc` + a `() => game.getTime()` getter (both available in canvas-host); its
  `update(ctx)` samples timecyc for the current hour and pushes colours/positions. Replaces the static
  `AmbientLightPlugin`/`DirectionalLightPlugin` for the game (the standalone viewers keep the static
  ones). Per-frame work is tiny (set a few uniforms/colours/vectors).
- **Post-FX pipeline** — this is where `EffectComposer` finally lands (the `RenderPipeline` seam already
  exists). A `PostFxPipeline` (`RenderPipeline`) hosts a render pass + effect passes (godrays now;
  bloom/SSAO/water/reflections later). Swapped in for `BasicRenderPipeline` when any effect is on; falls
  back to a plain render when all effects are off (zero overhead).

## timecyc fields used this iteration

| field | use |
|---|---|
| `skyTop`, `skyBot` | sky-dome vertical gradient (zenith → horizon) |
| `amb` | ambient light colour |
| `dir`, `dirMult` | directional (sun) light colour × intensity |
| `sunCore`, `sunCorona` | sun disc + corona/sprite colours |
| `sunSize`, `spriteSize`, `spriteBright` | sun disc size, corona size, brightness |
| `fogStart`, `farClip` | fog blend (ties into plan 024) + draw-distance sanity |

(`water`, clouds, `lowClouds/bottomClouds`, `ambObj`, shadows, etc. → later phases.)

## Sun path

A `sunDirection(hour)` model so the sun **rises at the east horizon and sets at the west horizon** at the
right times: elevation crosses 0 at sunrise/sunset, peaks near midday; azimuth sweeps east→south→west.
Parametrised (sunrise/sunset hour, peak elevation, azimuth span) and **tuned in-browser** against the
timecyc dawn/dusk keyframes (EXTRASUNNY_LA: 6am dawn, ~7–8pm dusk). The directional light points along
this direction (so shadows align later); the sun sprite sits far along it; both are hidden / dimmed when
the sun is below the horizon (night colours come from timecyc; moon is a later add).

## Decisions (confirmed)

Post-FX library = **pmndrs `postprocessing`** (added when godrays lands). **Godrays = next iteration**
(phases 1–3 first). Sky = timecyc gradient dome.

## This iteration — phases

1. ✅ **Sky dome — DONE.** `SkyPlugin` (`game/plugins/sky.plugin.ts`): a camera-following inverted
   `SphereGeometry` (radius 4000, `BackSide`, `depthWrite:false`, `renderOrder -1`, unfogged) with a
   `ShaderMaterial` gradient `skyBot`→`skyTop`, refreshed each frame from a plain colour sampler
   (`SkySample`). canvas-host loads timecyc **before** the plugins and passes
   `(hour) => sampleTimecyc(EXTRASUNNY_LA, hour)` + `() => game.getTime()/60`. Renderware-free (lives in
   `game/**`). Known seam: distant geometry still fogs to the static `FogPlugin` colour, not the dome
   horizon — fixed in phase 3.
2. ✅ **Sun + lights — DONE.** `SkyPlugin` now also owns the sun + lights (replaced the static
   Ambient/Directional plugins in canvas-host). `sunElevation(hour)` arcs the sun from the **east horizon
   at SUNRISE(6) → south at midday → west horizon at SUNSET(20)** (three world: +X east, +Z south, +Y up);
   below horizon at night. Two additive billboard sprites (core `sunCore`×`sunSize`, corona
   `sunCorona`×`sunSize`, corona opacity = `spriteBright`), unfogged, depth-tested so geometry occludes
   them, hidden below horizon. A directional light tracks the sun (colour `dir`, intensity
   `SUN_INTENSITY × max(0,sin elevation)` → fades at dawn/dusk, off at night); ambient lerps
   `AMBIENT_NIGHT↔AMBIENT_DAY` by sun height. **Note:** EXTRASUNNY `dir`/`dirMult` are constant
   (white/1), so day/night brightness rides the sun-height term, not timecyc `dir`. Tunable consts:
   `SUNRISE/SUNSET/MAX_ELEVATION/SUN_INTENSITY/AMBIENT_DAY/AMBIENT_NIGHT/CORE_SCALE/CORONA_SCALE`. Prelit
   vertex colours still bake daytime light, so night isn't fully dark yet (future: modulate prelit by
   timecyc). Verify with the debug Time slider.
3. ✅ **Fog colour from timecyc — DONE (pulled forward).** Adding the sky dome exposed a regression: the
   flat `scene.background` used to equal the fog colour, so fully-fogged distant geometry vanished into
   it; with a gradient sky it showed as pale ghosts (the LA skyline). Fix: `FogPlugin` takes a `horizon`
   sampler (`() => skyBot`) and per-frame sets `fog.color` + `scene.background` to the sky horizon
   (sRGB→linear so fogged geometry matches the dome's sRGB output). Also tightened
   `lodDrawDistance` 1500 → **1000** (just past `fog.distance` 800) so far geometry is culled right after
   it's fully fogged — removes the ghosts and is cheaper. (Distance from `fogStart`/`farClip` still
   optional later.)
4. ✅ **Godrays — DONE.** Added **pmndrs `postprocessing`** (dep). `GodRaysPlugin`
   (`game/plugins/godrays.plugin.ts`): an `EffectComposer` (RenderPass + `EffectPass(GodRaysEffect)`,
   half-res `resolutionScale 0.5`, `multisampling 4` to keep AA) whose light source is the **`SkyPlugin`
   sun Mesh** (the sun core is now a `Mesh`, not a Sprite, since GodRays needs a transparent
   non-depth-writing mesh; the corona stays a glow sprite). Hooked into the engine pipeline via a new
   `RenderPipeline.removePass`: the composer pass is added **only when `config.graphics.godrays` is on**,
   so disabling it falls back to a plain (cheaper, natively-AA) render. The shafts are further gated to
   sun-above-horizon and not-map-viewer. `Config.graphics.godrays` (+ 4 fixtures, default on),
   `Game.setGodrays`, and a **debug Game-screen toggle** ("God rays"). Tune in
   `godrays.plugin.ts` (samples/density/decay/weight/exposure/resolutionScale).
5. ✅ **Bloom + tone mapping — DONE.** Generalised the god-rays composer into a single post-FX host
   (`GodRaysPlugin` → **`PostFxPlugin`**, `game/plugins/postfx.plugin.ts`): one `EffectComposer` with three
   `EffectPass`es — god rays, `BloomEffect` (mipmap blur; intensity/threshold from `graphics.bloom`) and
   `ToneMappingEffect` (ACES, always on = cinematic base). Per-effect toggling via `EffectPass.enabled`
   (disabled = skipped, ~0 cost; `BlendFunction.SKIP` is deprecated and not a real disable). Composer is the
   pipeline render pass except in map-viewer (plain render). `Config.graphics.bloom { enabled, intensity,
   threshold }` (+4 fixtures, default on), `Game.setBloom`, debug Bloom checkbox + INTENSITY/THRESHOLD
   sliders. renderer.toneMapping stays NoToneMapping so ACES isn't double-applied.

6. ✅ **Water + sun glints — DONE.** A renderware-free **`WaterPlugin`** (`game/plugins/water.plugin.ts`,
   mirrors `SkyPlugin`) swaps the flat `MeshBasicMaterial` water (built in the adapter, plan 014) for a
   `ShaderMaterial`: animated ripple normals (procedural sine waves over world XZ + time), a **fresnel sky
   reflection** (deep `water` tint top-down → `skyBot` horizon at grazing angles) and a **specular sun
   glint** (`reflect(-sunDir)`, ripples shatter it into sparkles → pairs with bloom). Colours come from
   timecyc each frame (`water`/`skyBot`/`sunCore`), output **raw sRGB** like the sky dome. Sun direction via
   new `SkyPlugin.getSunDirection()`. The water mesh is loaded up front in canvas-host and passed to the
   plugin (added to the streaming root before `init`). `Config.graphics.water { glint, reflection }` (+4
   fixtures), `Game.setWater`, debug WATER GLINT (0–5) + WATER REFLECTION (0–1) sliders. Ripple
   freq/amp/shininess hardcoded in the shader. Later added: slow swell (rolling-highlight movement). A
   **depth-based shoreline foam** was built then **REMOVED** (depth pre-pass overhead + mediocre look) — see
   [[graphics]] memory; `WaterConfig` is `{ glint, reflection }`. Foam is a future redo (real foam texture /
   inward wave wash / reuse an existing depth source instead of a second scene render).

## Performance strategy

Single dome draw; effect passes at 0.5× res with capped samples; godrays gated on sun visibility; effects
fully bypassable (plain pipeline) so a low-end machine can turn them off; reuse one directional + one
ambient light; no shadow maps yet. Profile each phase in-browser before moving on.

## Open decisions (confirm)

- **Post-FX library:** add **pmndrs `postprocessing`** (merges effects into fewer passes → cheaper; clean
  GodRays/Bloom/SSAO later) vs three.js `examples/jsm` passes (no new dep, more passes). Recommend
  pmndrs for the perf goal.
- **Godrays now or next?** It's the costliest/riskiest piece; sky+sun+fog give a strong base alone. I lean
  to shipping phases 1–3 first, then godrays as a guarded add.
- **Sky model:** timecyc gradient dome (this plan, per your ask) vs a physical scattering `Sky` shader —
  staying with timecyc-driven gradient.

## Reserved for later phases (this plan will grow)

Moon + stars at night, **darker nights** (modulate prelit vertex colours by timecyc), other weathers + smooth
weather transitions, `ambObj` for peds/vehicles.
(bloom/tone-mapping — DONE phase 5; water + sun glints — DONE phase 6; **car reflections** — DONE plan 030;
**SSAO** — DONE; **sun shadows** (directional shadow map, view-following) — DONE; **clouds** (procedural FBM in
the dome shader, timecyc-coloured) + **anti-banding dither** — DONE.)
