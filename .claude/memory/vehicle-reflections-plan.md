---
name: vehicle-reflections-plan
description: Plan 030 — vehicle env-map reflections; ALL 4 phases DONE (parser + presets + sky-probe envMap + SA PC/PS2 sphere-map shader); tuning only
metadata:
  type: project
---

Plan 030 (`.claude/plans/030-vehicle-reflections.md`) — give cars GTA-SA env-map reflections + specular.
**ALL 4 PHASES DONE** (functionally complete). ⚠️ **Visual quality "так себе" (user 2026-06-08) — final
calibration DEFERRED on purpose:** the user wants to lift the **overall scene** (lighting/shadows/grade)
FIRST, then re-tune the cars against it. Don't keep micro-tuning reflection numbers in isolation; revisit
preset values (PC/PS2 reflectivity 0.2/0.45, enhanced clearcoat/reflectivity 0.4) once the scene looks better.
"Best picture, least cost": one shared sky-driven reflection probe, time-gated, opt-out.

**Phase 4 done (PC/PS2 SA sphere-map):** `buildMaterial` resolves the DFF-named env texture (vehicleenvmap128/
custom) from the merged texture map and wires an **`onBeforeCompile`** injection on the reflective
`MeshPhysicalMaterial` — an additive **matcap/sphere** reflection sampled by the **camera-space normal**
(screen-locked, faithful to `CCustomCarEnvMapPipeline`), added to `totalEmissiveRadiance` after
`<emissivemap_fragment>` (linear). Gated by a `saStrength` uniform (holder in `userData.saReflect`); plugin
sets it = coefficient×intensity×reflectivity for PC/PS2 (PC 0.7 / PS2 1.1), 0 for enhanced/off. Preset switch
= uniform update only (recompile only when the PBR envMap slot toggles). So: enhanced = PBR clearcoat sky
probe; PC/PS2 = additive screen-locked SA env smear; off = matte.

**Phase 2 done (preset registry + material plumbing):** `game/plugins/vehicle-reflection/` = `presets.ts`
(`ReflectionPreset` interface + `PRESETS` record {PC, PS2, enhanced}; extensible — one entry per preset, code
branches on a preset's *fields* source/technique/metalness/roughness/reflectivity/specular, never its name) +
`vehicle-reflection.plugin.ts` (`VehicleReflectionPlugin`). `Config.graphics.vehicleReflection { preset:string,
intensity }` (default `enhanced`, +4 fixtures), `Game.setVehicleReflection`. `buildMaterial` (renderware/three)
tags reflective materials with `userData.reflection` (raw DFF data, shape = `VehicleReflectionData` in the
plugin; written as plain userData so renderware stays game-type-free); `buildVehicle` collects them
(traverse root) → `BuiltVehicle.reflectiveMaterials` → `VehicleModel.reflectiveMaterials`. canvas-host
`spawnVehicle` calls `reflection.register(...)`/despawn `unregister(...)`. Plugin applies preset: roughness↓ +
`envMapIntensity` (coefficient×intensity×preset.reflectivity); **metalness only when `material.envMap` is set**
(no probe yet → matte, avoids dark PBR metal). Debug: "Car reflect" preset cycle + REFLECT INTENSITY slider.
**Phase 3 DONE (sky-probe envMap):** `SkyPlugin` exports `SKY_PROBE_LAYER` (1) and enables it on dome+sun.
`VehicleReflectionPlugin(getHours)` owns a `WebGLCubeRenderTarget`(128, mipmapped) + `CubeCamera`
(`layers.set(SKY_PROBE_LAYER)` → sky-only, the 6 child cameras share `cubeCamera.layers`), positioned at the
main camera, re-rendered only when game-time moved ≥0.25h (in `update()`). `applyTo` uses a **clearcoat**
approach (metalness-based env washed out the paint — user feedback): reflective materials are built as
**`MeshPhysicalMaterial`** (in `buildMaterial`) with `metalness 0` (saturated diffuse paint) + a reflective
**`clearcoat`** (glossy lacquer reflecting the probe; paint shows through). enhanced = clearcoat 1 /
clearcoatRoughness 0.15 / reflectivity **0.4** / roughness 0.6. **REFLECT INTENSITY scales `envMapIntensity`**
(`= reflectivity × intensity`), NOT clearcoat — because the envMap on MeshStandard/Physical also adds **diffuse
IBL (sky ambient)** that washes out upward faces if too strong (user: "пересвечены"); keep it modest. clearcoat
is constant (the sun still highlights the lacquer at low env intensity). `needsUpdate` set each apply (rare).
User accepted the look at reflectivity 0.4. Cars reflect the
real timecyc sky. **Colour-space gotcha FIXED:** the sky dome outputs raw (already-sRGB) colours, so the probe
texture must be `colorSpace = SRGBColorSpace` or the PBR reflection is ~1.5× too bright (user: "пересвеченными");
also keep `reflectivity`/`metalness` low (enhanced = 0.8/0.2) — it's a subtle paint sheen, not chrome. Phase 4 =
SA sphere-map shader for PC/PS2 (decided: faithful).

**Phase 1 done:** `RWMaterial.effects` now carries `{ envMap?: {coefficient, texture, useFrameBufferAlpha},
reflection?: {intensity, offset, scale}, specular?: {level, texture} }`, parsed from the material's Extension
(`MATFX 0x120`, `REFLECTION_MAT 0x253f2fc`, `SPECULAR_MAT 0x253f2f6` in `constants.ts` + `MatFxEffect` enum).
The MatFX **embeds the env-texture name** (per-material coefficient 0/0.5/1) — usually `vehicleenvmap128`/
`xvehicleenv128`, but **can be custom per car** (our bundled "admiral" is a custom Mustang → `generic_reflection01`
+ `vehicle_generic_chromeprts` from its own TXD) → resolve against the merged car+generic texture map. Tests in
`dff.test.ts` (synthetic + gated real `admiral.dff`). **PC/PS2 fidelity DECIDED: build the faithful SA
sphere-map shader (phase 4), not a PBR approximation.**

**Driven by an extensible PRESET** (`Config.graphics.vehicleReflection.preset`, inspired by SkyGFX's
per-platform pipelines): **`PC`** = faithful original (static `vehicleenvmap128` sphere-map via a custom
"camera-space-normal → sphere UV, additive" shader = SA's `CCustomCarEnvMapPipeline`); **`PS2`** = same but
brighter/glossier; **`enhanced`** = our improved path (real **sky-cube probe** via three PBR `envMap`, like
Xbox "neo" world reflections). Presets are a **strategy registry** (`ReflectionPreset` interface + `PRESETS`
record); `preset` is a plain string key into it → **adding a preset = one entry, code branches on the
preset's *fields* (source/technique/intensity/specular), never its name**. DFF data (which materials reflect,
coefficient, intensity, specular) is parsed once, preset-independent. NB: three's built-in `envMap` ≠ SA's
sphere-map, so `PC`/`PS2` need a custom shader (the two techniques are separate code paths the preset picks).

**Research (verified by decoding `static/vehicles/admiral.dff` + `static/models/generic/vehicle.txd`):** SA
car body materials carry three RenderWare **material-plugin extension chunks** the current `dff.ts`
**ignores** (they sit as direct children of the Material chunk, after the `TEXTURE`):
- **MatFX (Material Effects) `0x0120`** — `effectType=2` (ENVMAP), `coefficient` (admiral 0.5),
  `useFrameBufferAlpha`, optional env Texture child (**SA omits it → uses a global env texture**).
- **Reflection Material `0x0253F2FC`** (24 B, SA custom pipeline) — `scaleX,scaleY,offsetX,offsetY` (1,1,1,1)
  + `intensity` (0.03) + u32. ⚠️ exact field order/semantics to re-verify in code across cars.
- **Specular Material `0x0253F2F6`** (28 B) — `level` (0.12) + 24-char tex name (**`vehiclespecdot64`**).
- (`0x0253F2FD`, 4 B at geometry-ext level = unidentified SA plugin, **not** reflection — ignore.)

The reflection texture is **global**, in the shared `generic/vehicle.txd` (already merged in `loadVehicle`):
**`vehicleenvmap128`** (128² spherical env map) + `xvehicleenv128` (variant) + `vehiclespecdot64` (specular
dot). SA algorithm = second pass sampling `vehicleenvmap128` with UVs from the **vertex normal in camera
space** (sphere map), × coefficient×intensity, additive, camera-scroll fakes motion.

**Plan shape:** (1) parse the 3 plugins into `RWMaterial.effects` (+ unit test on admiral.dff); (2)
`buildMaterial` → metalness/roughness/envMapIntensity (maybe `MeshPhysicalMaterial` clearcoat) for reflective
materials; (3) a renderware-free **`VehicleReflectionPlugin`** (`game/**`, like [[graphics]]'s SkyPlugin)
owning a low-res **CubeCamera probe that renders the sky dome+sun only, regenerated on time-of-day change**
(the cost saver), injecting `material.envMap` into reflective vehicle materials; (4) `Config.graphics.reflections
{ enabled, intensity, metalness }` + `Game.setReflections` + debug sliders. Fallback = static `vehicleenvmap128`
(option A); future = full-scene cube probe (C). Current vehicle materials: `build-clump.buildMaterial` →
`MeshStandardMaterial` metalness 0 / roughness 1. Related: [[graphics]], [[vehicle-loading-plan]].
