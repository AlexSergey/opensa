# 034 — Night fill for dynamic objects (player + vehicles)

Light the **dynamic** meshes (the player character, spawned vehicles) at night so they aren't black, **without**
disturbing the carefully-tuned static-map night look and at **~zero performance cost**. Reuses the dusk/dawn
fade idea from [[032-night-and-lights]] (fade an intensity uniform, like the ACES tonemap).

Status: **DONE (v1, user-accepted — "looks great").** A deliberately cheap shader fill (not real lights);
stylised, so likely revisit once shadows are reworked ([[shadows-deferred]]). Looks good in-browser.

**Landed:** `three/night-fill.ts` (`nightFillUniform` + `applyNightFill`, composes with the vehicle reflection's
`onBeforeCompile`); injected in `build-skinned-clump.ts` (player) + `build-vehicle.ts` (car body, glass skipped);
driven in `canvas-host.tsx` from the **sun-height** night factor × strength; config
**`night.dynamicObjectsFill = { strength: 1.0, rim: 0.1 }`** (`DynamicObjectsFillConfig`); debug **Atmosphere**
tab sliders (NIGHT FILL / NIGHT FILL RIM). tsc + eslint clean, 86 tests pass.

**Key fix (why v1 first looked awful):** a *flat additive* emissive washed the dynamics to textureless grey
(at night their albedo ≈ 0, so only the flat add showed). The fill must **modulate the object's own albedo**:
`totalEmissiveRadiance += hemiMoon * diffuseColor.rgb` — so the car paint / CJ's clothes show, dimly moonlit,
like real light. Only the faint fresnel rim stays additive. Colours are fixed cool defaults in `night-fill.ts`
(not yet config). Fade rides the **sun-height** factor (not the clock `litFade` used by windows/tonemap) — both
hit 0 by day; can be synced to `clockNightFactor` in one line if wanted.

## Problem (root cause)

Static map geometry looks great at night because it carries **baked night vertex colours** (SA's `0x253F2F9`
set) that the shader adds as **emissive** — the buildings/roads self-illuminate ([[032-night-and-lights]] phase
10, [[night-vertex-tonemap-clock]]). **Dynamic meshes have no such baked layer.** They're lit only by the
real-time lights — `SkyPlugin`'s `ambient` (timecyc `ambObj`, ~0.04 at night), `sun` (directional, intensity 0
when the sun is below the horizon), and the `skylight` hemisphere (a dim moonlit blue × `night.skylight`). At
night those are all near-zero, so CJ and the cars read as black. The map cheats with emissive; the dynamics
can't, so they need their own night fill.

## Research — why not "just add a helper light on a layer"

The obvious idea (add an `AmbientLight`/`HemisphereLight`/point light that lights **only** the player + cars via
`Object3D.layers`) **does not work in one render pass in our three.js (r0.177.0).** The forward renderer gates
lights by the **camera's** layers, not by each lit object's layers:

```
// three/src/renderers/WebGLRenderer.js (r177), projectObject — lines ~1315 / ~1333
if ( object.isLight && object.layers.test( camera.layers ) ) { … push to render state … }
```

So a light is either in the scene's light list (lights **everything** rendered that frame) or not — there's no
per-object "this light only affects these meshes" in the standard path. Selective lighting by layers needs a
**second render pass** with a different `camera.layers`, which costs an extra pass (rejected — not cheap).

**Verified on the latest three (r184) too** — same code, same camera-layer gating; upgrading doesn't help. The
only renderer with flexible per-object light scoping is the **WebGPURenderer / TSL node materials** (`LightsNode`),
which is a whole-renderer migration — out of scope for this prototype.

### Approaches considered (by cost)

1. **Shader "night fill" baked into the dynamic materials — CHOSEN.** Add a cheap term in the fragment shader
   of the character + vehicle materials, faded by a shared uniform at night. **~Zero cost** (no extra lights,
   draws, shadow maps, or passes; ~a dozen ALU only on dynamic-object pixels — a small screen area). **Does not
   touch the map** (only those materials are patched). No shader recompile — the `onBeforeCompile` is set once,
   we animate only the uniform (same lesson as the tonemap/`castShadow` stability note in 032/033).
2. **One player-attached non-shadow light, faded at night.** Real lighting → good form, cheap-ish (1 light), but
   it **also lights the map around the player** (a moving glow pool) which fights the baked night. Less clean.
3. **Raise the global night `skylight`.** Trivial but **washes the whole tuned map**. Rejected.
4. **Layers + a second render pass for dynamics.** Cleanest separation, but +1 pass. Rejected (cost).

## Chosen design — prototype #1

A shared **`nightFillUniform = { value: 0 }`** (mirrors `nightColorUniform` in `three/night-vertex-colors.ts`)
plus a small `onBeforeCompile` injected into the dynamic materials. Per fragment, add a **fake hemisphere** fill
(moonlight from above) and an optional **fresnel rim** (cool edge sheen for definition), scaled by the uniform:

```glsl
// pseudo — added near <emissivemap_fragment> (after `normal` + vViewPosition exist)
vec3  fillSky    = uFillSky;     // cool moonlight from above
vec3  fillGround = uFillGround;  // darker bounce from below
float hemi  = normal.y * 0.5 + 0.5;                 // world-up-ish; view-normal is fine for a subtle look
vec3  fill  = mix( fillGround, fillSky, hemi );
float rim   = pow( 1.0 - saturate( dot( normal, normalize(vViewPosition) ) ), uFillRimPow );
totalEmissiveRadiance += (fill + uFillRim * rim) * uNightFill;
```

- **Form, not a flat sticker:** the hemisphere term gives top-lit shape; the rim gives edge definition. Both are
  arithmetic — no textures/lights.
- **Add as emissive** (self-illumination) so it's independent of the dead night lights and never darkens day.
- **Fade:** `nightFillUniform.value` driven each frame by a night factor — start with the **sun-height** factor
  (`sky.godraysSource.userData.night`, "how dark is it") since the fill should track real darkness/weather;
  alternatively the clock `clockNightFactor` to sync with the lit windows. Decide in-browser. Intensity-only →
  no recompile, exactly like the tonemap fade ([[night-vertex-tonemap-clock]]).

### Where to inject (bounded, known set)

- **Player:** the skinned material(s) from `renderware/three/build-skinned-clump.ts`.
- **Vehicles:** the materials from `renderware/three/build-vehicle.ts` (body + parts; skip glass/lights if they
  look wrong). Vehicles already carry env-map reflections + headlights — the fill is just body form.
- Reuse the `applyNightVertexEmissive` pattern (a `customProgramCacheKey` + `onBeforeCompile` helper) so all
  dynamic materials share one program.

## Config + debug

- `Config.graphics.night` (new sub-keys or a `fill` object): **strength** + **sky/ground tint** (+ maybe rim
  strength/power). Defaults: a cool dim moonlight (tie tint to `night.tint` for consistency).
- **Debug → Atmosphere tab** (the one added for `litFade`): sliders for fill strength + tint so the look is
  tunable in-browser without rebuilds (mirror the existing night sliders).

## Files to create / change

- **New:** `renderware/three/night-fill.ts` — `nightFillUniform` + `applyNightFill(material)` (the helper), and
  the fill uniforms (sky/ground/rim). Export from `renderware/index.ts`.
- **Change:** `build-skinned-clump.ts` + `build-vehicle.ts` — call `applyNightFill` on the built materials.
- **Change:** `canvas-host.tsx` — drive `nightFillUniform.value` (+ tint uniforms) from the night factor in a
  small system (next to the `coronas` system).
- **Change:** `config.interface.ts` (+ default in `canvas-host.tsx`) and `debug-overlay.tsx` (Atmosphere sliders).

## Verification

- Drive/walk at night: CJ + cars read as moonlit (form + a faint cool rim), not black; by day they're unchanged
  (uniform = 0 → term vanishes; confirm no day cost / no recompile at dusk).
- The **static map is untouched** (only dynamic materials patched) — compare a building before/after.
- Perf: no new draw calls/lights/passes; check the dusk transition doesn't hitch (no light-count change).

## Out of scope / prototype caveats

- Not physically-correct lighting — a stylised fill. Good enough for "not black"; revisit with the **shadow
  rework** ([[shadows-deferred]]) when the whole dynamic-lighting model is redone.
- Glass/transparent vehicle parts may need exclusion (rim on glass can look odd).
- If a moving real key-light (approach #2) turns out to look much better, it's an easy swap later.

Related: [[032-night-and-lights]], [[night-vertex-tonemap-clock]], [[shadows-deferred]], [[033-vehicle-headlights]].
