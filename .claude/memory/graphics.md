---
name: graphics
description: Graphics base plan 029 — timecyc-driven sky/sun/fog + (later) godrays; phase 1 sky dome done
metadata:
  type: project
---

Plan 029 (`.claude/plans/029-graphics.md`) — "best picture, least cost"; timecyc-driven, **EXTRASUNNY_LA
only** this iteration. Decisions: post-FX lib = pmndrs **`postprocessing`** (added with godrays); **godrays
= next iteration**; sky = timecyc gradient (not physical scattering).

Architecture: a **`SkyPlugin`** (atmosphere) drives sky/sun/lights/fog from `sampleTimecyc(...)` per frame;
a future `PostFxPipeline` (EffectComposer) hosts effects (godrays/bloom/water/SSR/shadows later). Plugins
stay renderware-free — canvas-host passes a plain colour **sampler** closure (layer rule: `game/**` ≠
renderware). Timecyc is now loaded in canvas-host **before** the plugins.

Phase 1 DONE: `game/plugins/sky.plugin.ts` `SkyPlugin` — camera-following inverted sphere (r=4000,
BackSide, depthWrite off, renderOrder -1, frustumCulled off, unlit ShaderMaterial) gradient
`skyBot`(horizon)→`skyTop`(zenith), `SkySample` = {skyTop, skyBot} from `sampleTimecyc(EXTRASUNNY_LA,
getTime()/60)`. Colours set via `Color.setRGB(r/255,…)` and output raw (ShaderMaterial doesn't apply
output colorspace) so authored sRGB shows as-is.

Phase 2 DONE: `SkyPlugin` also owns the sun + lights now (static Ambient/Directional plugins dropped from
canvas-host). `sunElevation(hour)`: sun arcs east(+X)→south(+Z)→west(−X), +Y up, peak midday, below
horizon outside SUNRISE(6)–SUNSET(20). Two additive sun sprites (core `sunCore`×`sunSize`, corona
`sunCorona`×`sunSize`, opacity=`spriteBright`), unfogged, depth-tested, hidden at night. Directional light
tracks the sun (colour `dir`, intensity `SUN_INTENSITY·max(0,sin elev)`); ambient lerps
AMBIENT_NIGHT↔AMBIENT_DAY by sun height. EXTRASUNNY `dir`/`dirMult` are constant → day/night rides
sun-height, not timecyc dir. Tunables: SUNRISE/SUNSET/MAX_ELEVATION/SUN_INTENSITY/AMBIENT_*/CORE_SCALE/
CORONA_SCALE. Caveat: prelit vertex colours bake daytime light → night not fully dark yet (later: modulate
prelit by timecyc). Phase 3 (fog colour from timecyc) already DONE.

Phase 4 DONE (godrays): added dep **pmndrs `postprocessing`**. (Composer now lives in `PostFxPlugin`,
`game/plugins/postfx.plugin.ts` — see below.) EffectComposer (RenderPass + EffectPass(GodRaysEffect),
resolutionScale 0.5) with the **SkyPlugin sun Mesh** as light source (sun core is now a
`Mesh`, not Sprite, since GodRays needs a transparent non-depth-writing mesh; corona stays a sprite).
Pipeline gained `removePass`: the composer pass is added **only when `config.graphics.godrays`** → off =
plain native-AA render (zero post-FX cost). Shafts gated to sun-up + !mapViewer. `Config.graphics.godrays`
(default on, +4 fixtures), `Game.setGodrays`, debug Game-screen "God rays" toggle. Tunables in the plugin.
Smooth time: sun/sky read `game.getHours()` (continuous), HUD/clock stay whole-minute.

Sun size is config-driven: `Config.graphics.sunSize` (default **15**, world units; +4 fixtures), `Game.setSunSize`,
debug Game-screen "SUN SIZE" slider. Visible sun disc world size = `sunSize × timecyc.sunSize`; corona =
`core × CORONA_RATIO(4.5) × spriteSize` (old fixed `CORE_SCALE`/`CORONA_SCALE` consts removed). Note:
any `Game` setter touching `config.graphics` must spread the existing object (`setConfig` is a shallow
`Object.assign`) — `setGodrays`/`setSunSize`/`setGodraysSize` all do.

God-rays strength is **decoupled** from the visible disc: `Config.graphics.godraysSize` (default **30**),
`Game.setGodraysSize`, debug "RAYS SIZE" slider. `SkyPlugin` owns a **second Mesh `godraysSource`** (shares
the disc geometry, own material) sized `godraysSize × timecyc.sunSize`, positioned/coloured like the disc but
**not added to the scene** — `GodRaysEffect` temporarily moves its light-source Mesh into its own internal
`lightScene` each frame, so the source needn't be in the main scene. `GodRaysPlugin` is constructed with
`sky.godraysSource` (not `sunSource`); its sun-up gate reads that mesh's `.visible`. So a small disc (15) can
emit strong shafts (30).

**Gotcha (cost us a "no godrays at all" regression):** because `godraysSource` is **not** in the scene, the
renderer never refreshes its matrix, and `GodRaysEffect.update` reads `lightSource.matrix` with
`matrixAutoUpdate` forced off — so the source rendered at the **origin** (no visible rays). Fix: `SkyPlugin.apply`
calls `this.godraysSource.updateMatrix()` every frame after setting position/scale to bake the transform.

God-rays **shader tuning** is config too: `Config.graphics.sky` (sub-object) = `{ density 0.96, exposure 0.5,
weight 0.4 }` (+4 fixtures), exported as `SkyConfig` from the game barrel. `Game.setSky(patch)` merges into
`graphics.sky`; `GodRaysPlugin.configChanged` pushes them onto the live `godRaysMaterial` (density/exposure/
weight setters). Debug Game-screen sliders DENSITY/EXPOSURE/WEIGHT (0–1). (decay/samples/resolutionScale stay
hardcoded in the plugin.)

**Config shape (current):** `Config.graphics = { bloom: BloomConfig, sky: SkyConfig, sun: SunConfig, toneMapping: boolean, water: WaterConfig }`.
`SkyConfig` = { density, exposure, weight } (god-rays shader). `SunConfig` = { godrays: boolean, godraysSize,
sunSize }. `BloomConfig` = { enabled, intensity, threshold }. (`SkyConfig`/`BloomConfig` exported from the game
barrel — `ui` debug imports them.) `Game.setSky`/`setSun`/`setBloom(patch)` do the nested merge (`setConfig` is
shallow); `setGodrays`/`setGodraysSize`/`setSunSize` delegate to `setSun`.

**Post-FX host (renamed from GodRaysPlugin → `PostFxPlugin`, `game/plugins/postfx.plugin.ts`):** owns the
single `EffectComposer` and three separate `EffectPass`es sharing it — **god rays** (sun mesh), **bloom**
(`BloomEffect`, mipmapBlur, intensity/threshold from `graphics.bloom`) and **ACES tone mapping**
(`ToneMappingEffect`, ToneMappingMode.ACES_FILMIC, **off by default** — `config.graphics.toneMapping`). Per-effect toggles
use `EffectPass.enabled` (a disabled pass is skipped → ~0 cost; can't use `BlendFunction.SKIP`, it's
deprecated/doesn't fully disable). godrays pass enabled = `sun.godrays && sunSource.visible`; bloom pass =
`bloom.enabled`. Composer is the pipeline render pass except in **map-viewer** (plain render via `removePass`).
renderer.toneMapping stays NoToneMapping (default) so ACES isn't double-applied. Debug Game-screen: Bloom
checkbox + INTENSITY (0–3) + THRESHOLD (0–1) sliders + "Tone map (ACES)" checkbox. Tunables:
BLOOM_RADIUS/BLOOM_SMOOTHING in the plugin.

**Gotcha — ACES washed the image out (user: "very dull and pale", godrays disappeared):** the pipeline
is **LDR** (GTA textures are already final-looking, ~no values >1), and ACES filmic on LDR input just crushes
contrast/saturation and lifts blacks → milky, and it compressed the additive god-rays into nothing. So tone
mapping is **off by default** (`Game.setToneMapping` / debug checkbox to try it). Proper ACES would need an
actual HDR pipeline (lights/sun emitting >1 + exposure) — future. Bloom stayed on (subtle highlight glow;
threshold compared in linear, so the ~0.6-linear sky doesn't bloom, only the bright sun/horizon).

**Phase 6 DONE (water + sun glints):** `WaterPlugin` (`game/plugins/water.plugin.ts`, renderware-free, mirrors
SkyPlugin) **replaces the flat water mesh's `MeshBasicMaterial`** (built in the adapter, plan 014) with a
`ShaderMaterial` — animated ripple normals (procedural sines over world XZ + `clock.elapsed`), fresnel sky
reflection (`water` tint → `skyBot` at grazing angles), specular **sun glint** (`reflect(-sunDir)`, sparkles
→ bloom). Colours per-frame from a `WaterSample` (timecyc `water`/`skyBot`/`sunCore`) set as **raw sRGB** (no
colorspace) to match the sky dome. Sun dir via new **`SkyPlugin.getSunDirection()`**. The water mesh is loaded
**up front** in canvas-host (before `init`) and passed to the plugin (it needs to own the material at install);
added to the streaming root before init. `Config.graphics.water { glint, reflection }` (+4 fixtures),
`Game.setWater`, debug WATER GLINT/REFLECTION sliders. Ripple freq/amp/shininess hardcoded in the shader.
Glint must be a **noisy multi-directional ripple** (4 crossing octaves) or it reflects as one coherent
**line** instead of a shimmering sparkle path (user feedback). Also added: a slow **swell** (low-freq sines)
whose slope tilts the normal → drifting/rolling highlights so the surface isn't dead-flat.

⚠️ **Shoreline foam — BUILT then REMOVED (user 2026-06-08: noticeable overhead, dropped for the demo; REDO
later).** It was real **depth-based** foam: each frame `WaterPlugin` did a depth pre-pass (hide water,
`scene.overrideMaterial = MeshDepthMaterial`, render to a `WebGLRenderTarget` + 24-bit `DepthTexture`), and the
water fragment compared scene depth (`perspectiveDepthToViewZ` from `#include <packing>`) to its own viewdist
→ small gap = foam, FBM-noise-textured. Two problems: the extra depth-only **full-scene render** is real
overhead, and the *look* was mediocre (too wide on gentle beaches, blotchy). **Fully reverted** — no depth
target, no `water.foam` config/slider; `WaterConfig` is back to `{ glint, reflection }`. Future redo ideas:
real foam **texture** scrolled along the shore; thinner band + distance-fade; inward wave-wash animation;
**reuse an existing depth source** instead of a dedicated pre-pass (so no second scene render).

**SSAO (added 2026-06-08):** `PostFxPlugin` now also hosts ambient occlusion — a `NormalPass` (scene normals)
feeds an `SSAOEffect` (MULTIPLY blend, half-res, `worldDistanceThreshold` ~300 for the big GTA coords),
placed right after the RenderPass (darkens corners/contacts before god-rays/bloom). `Config.graphics.ssao
{ enabled, intensity, radius }` (default on, intensity 1.5, radius 0.2; +4 fixtures), `Game.setSsao`, debug
SSAO checkbox + AO INTENSITY / AO RADIUS sliders. **enabled=false skips the NormalPass + SSAO pass entirely
(zero cost — the NormalPass is an extra full-scene normal render).** Shadows (directional shadow map) chosen
as the *later* big step; SSAO first (user 2026-06-08).

**Gotcha — composer MSAA crashed the scene (`glBlitFramebuffer: Depth/stencil buffer format combination
not allowed for blit`, scene wouldn't load):** `EffectComposer({ multisampling: 4 })` can't resolve a
multisampled depth/stencil blit alongside the GodRaysEffect depth texture. Fix: **no MSAA on the composer**
(`new EffectComposer(renderer)`); antialiasing is an **`SMAAEffect`** added as the final EffectPass (pmndrs'
recommended AA with post-processing). renderer.antialias:true only covers the map-viewer plain-render path.

Related: [[timecyc]], [[game-time]], [[fog]].
