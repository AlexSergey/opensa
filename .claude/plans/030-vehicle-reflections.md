# 030 — Vehicle reflections (env map + specular)

A **big** feature, planned now, built later. Give cars the shiny env-map reflection + specular sheen GTA SA
has, driven by the data the DFF already carries and integrated with our timecyc sky. Goal stays **best
picture, least cost**: a single shared, infrequently-updated reflection probe — no per-car render, opt-out.

**Driven by a configurable, extensible PRESET** (`Config.graphics.vehicleReflection.preset`), inspired by
[SkyGFX](https://github.com/aap/skygfx) (which emulates per-platform rendering for SA): **`'PC'`** = faithful
to the original PC look; **`'PS2'`** = the glossier console look; **`'enhanced'`** = our improved real-sky
reflections. Presets are a **strategy registry** — adding a new one is a single entry, no other code touched
(see §2/§6).

---

## 1. Research — how GTA SA does vehicle reflections (verified against our real DFFs)

Decoded from `static/vehicles/admiral.dff` + `static/models/generic/vehicle.txd` (dump scripts were
throwaway). Every car body material carries **three RenderWare material-plugin extension chunks** that the
stock loader currently ignores:

| chunk | id | size | meaning |
|---|---|---|---|
| **MatFX (Material Effects)** | `0x0120` | ~113–119 B | RW standard material effect. For SA cars: `effectType = 2` = **ENVMAP**. Holds `coefficient` (per-material: **0 / 0.5 / 1**), `useFrameBufferAlpha`, `hasTexture`, and (when set) an **embedded env-map Texture chunk with a name**. The name is usually the global `vehicleenvmap128`/`xvehicleenv128`, **but can be custom per car** (the bundled "admiral" is a custom Mustang: `generic_reflection01`, `vehicle_generic_chromeprts` from its own TXD). ⟶ resolve the name against the **merged** texture map (car TXD + generic `vehicle.txd`). |
| **Reflection Material** (SA) | `0x0253F2FC` | 24 B | SA custom-pipeline reflection params: `scaleX, scaleY, offsetX, offsetY` (admiral = 1,1,1,1) + **`intensity`** (admiral = **0.03**) + a u32. Drives env-map UV scale/scroll + per-material reflection strength. Present on **every** material. |
| **Specular Material** (SA) | `0x0253F2F6` | 28 B | `level` (admiral = **0.12**) + a 24-char **specular texture name** = **`"vehiclespecdot64"`**. The glossy highlight. Present on the metal body materials. |

(There's also a 4-byte `0x0253F2FD` at the geometry-extension level — unidentified SA geometry plugin, **not**
reflection-related; ignore.)

**The global textures** live in the shared `generic/vehicle.txd` (already merged into each car's texture map
in `loadVehicle`). Relevant entries (19 total):
- **`vehicleenvmap128`** — the 128² **spherical environment/reflection map** (THE car reflection texture).
- `xvehicleenv128` — alternate env map (PS2/variant).
- **`vehiclespecdot64`** — the 64² specular dot highlight (referenced by the specular plugin).
- (others: `vehiclegrunge256`, `vehiclelights128/lightson128`, `vehiclegeneric256`, tyres/steering/dash, plates…)

**The SA algorithm** (`CCustomCarEnvMapPipeline`): the car renders normally, then reflective materials get a
second pass that samples `vehicleenvmap128` with UVs generated from the **vertex normal in camera space**
(spherical map: ~`uv = normalize(viewNormal).xy * scale * 0.5 + 0.5 + scroll`), scaled by the MatFX
coefficient × reflection-material intensity, blended additively. A camera-driven scroll fakes the world
sliding across the paint. Specular adds `vehiclespecdot64` along the light vector × `level`. **So which
materials reflect, and how much, is data we can read straight from the DFF** — chrome/paint body panels have
MatFX ENVMAP; glass/tyres/interior generally don't (or carry only a weak reflection-material entry).

**Key takeaways for our implementation**
- Reflection is a **global env map**, not per-car geometry → one shared probe is faithful.
- The DFF tells us **per-material**: is-reflective (MatFX present), reflection strength (coefficient ×
  intensity), and specular (level + texture). We translate these to three.js material params.
- SA's authored intensity is **subtle** (0.03–0.5 range); we'll expose a multiplier so it can be pushed.

---

## 2. Architecture (fits existing patterns)

Two layers, mirroring how Sky/Water already split:

- **Renderware layer (allowed to import renderware):** extend the **DFF parser** to read the 3 plugins, and
  **`build-vehicle`/`build-clump`** to translate them into three material properties (envMap slot, metalness,
  envMapIntensity, roughness/specular). Pure data → material; no scene/plugin knowledge.
- **`game/**` layer (renderware-free):** a **`VehicleReflectionPlugin`** that owns the shared **environment
  map** and keeps it in sync with the time of day, and hands it to the vehicle materials. Mirrors `SkyPlugin`
  (it can read the same sky sampler / sun direction; it must NOT import renderware).

### Preset strategy (the crux + the extensibility ask)

How the reflection is *sourced and applied* is the **preset**. The DFF data (§1) — which materials reflect,
coefficient, intensity, specular — is **read once, preset-independent**; the preset only decides the **env-map
source**, the **coordinate/blend method**, and **tuning**. Defined as an extensible registry:

```ts
// game/plugins/vehicle-reflection/presets.ts (renderware-free)
interface ReflectionPreset {
  label: string;
  source: 'sa-envmap' | 'sky-probe';          // where reflections come from
  technique: 'sa-spheremap' | 'pbr-envmap';    // how UVs/blend are computed
  intensity: number;                            // global multiplier over the DFF values
  specular: 'sa-dot' | 'pbr' | 'off';
  // ...future knobs (roughness curve, glass reflect, scroll speed) added here only
}
const PRESETS: Record<string, ReflectionPreset> = { PC: {...}, PS2: {...}, enhanced: {...} };
```

`Config.graphics.vehicleReflection.preset` is just a **key into `PRESETS`** → **adding a new preset = add one
entry**, nothing else changes (the plugin/material code branches on the preset's *fields*, never on its name).

| preset | source | technique | look (≈ SkyGFX) | cost |
|---|---|---|---|---|
| **`PC`** | `vehicleenvmap128` (static sphere map) | `sa-spheremap` — per-vertex UV from **camera-space normal** into the sphere map, additive × coefficient×intensity (custom shader, faithful to `CCustomCarEnvMapPipeline`) | original PC chrome — subtle, matte | ~0 |
| **`PS2`** | `vehicleenvmap128` | `sa-spheremap`, **brighter/glossier** blend + higher intensity (PS2 vehicle pipeline) | vivid PS2 reflections | ~0 |
| **`enhanced`** | **sky-probe** (low-res `CubeCamera` over the sky dome + sun, regenerated on time-of-day change) via three PBR `envMap`+metalness | `pbr-envmap` | **real timecyc sky** in the paint (dawn orange / noon blue / the sun) + sun specular — like Xbox "neo" world reflections | low (1-mesh cube, infrequent) |

Recommended default: **`enhanced`** for the demo's "best picture"; `PC` is the authentic baseline. (Reserved
future presets the registry makes trivial: `xbox-neo` full-scene probe, `mobile`, a `PC`+`vehicleenvmap128`
detail-mix over the sky probe.)

**Note on faithfulness:** three's built-in `envMap` uses a physically-based reflection vector — that's the
`enhanced`/`pbr-envmap` path. The `PC`/`PS2` `sa-spheremap` look is **not** three's default reflection; it
needs a **custom shader** that reproduces SA's "normal-in-view → sphere-map UV → additive" (this is exactly
what SkyGFX's PC/PS2 vehicle shaders do). So the two techniques are genuinely different code paths the preset
selects between — budget for both if we want `PC` to actually match the original.

---

## 3. Parser changes (`renderware/parsers/binary`)

- `constants.ts`: add `MATFX: 0x120`, `REFLECTION_MAT: 0x253f2fc`, `SPECULAR_MAT: 0x253f2f6` to `RwSection`;
  a `MatFxEffect` enum (`ENVMAP = 2`, …).
- `types.ts`: extend `RWMaterial` with an optional **`effects`** field:
  ```ts
  reflection?: { coefficient: number; intensity: number; scale: [number, number]; offset: [number, number]; envTexture: string | null };
  specular?: { level: number; texture: string };
  ```
- `dff.ts` `parseMaterial`: after the texture, walk the material's children for the 3 plugin chunks and fill
  `effects`. (Material plugins sit as **direct children of the Material chunk**, after `TEXTURE`, per the dump
  — not under an `EXTENSION` wrapper here.) Parse MatFX struct (effectType, coefficient, useFBAlpha, optional
  Texture child), the 24-B reflection floats, the 28-B specular (float + char[24]).
- **Verify exact field order/semantics of the 24-B reflection plugin** in-code against several cars (admiral,
  camper, infernus-like) — our decode read `1,1,1,1,0.03`; confirm which is intensity vs scale before trusting
  it. Unit-test the parse on `admiral.dff` (assert MatFX coefficient 0.5, specular `vehiclespecdot64`).

## 4. three.js mapping (`renderware/three/build-clump` + `build-vehicle`)

In `buildMaterial`, when `rw.effects?.reflection` / MatFX ENVMAP is present:
- Mark the material **reflective**: raise `metalness` (e.g. 0.6–1.0 for body panels), lower `roughness`
  (gloss from specular `level`), set `envMapIntensity` from `coefficient × intensity × <config multiplier>`.
- Leave the **`envMap` slot empty at build time** — the `VehicleReflectionPlugin` injects the shared probe
  texture into every reflective vehicle material after spawn (build-vehicle returns the list of reflective
  materials, or the plugin walks the car's meshes). Avoids the parser/build layer needing a live scene probe.
- Specular: either fold into `roughness`/`metalness`, or (nicer) use `MeshPhysicalMaterial` **clearcoat** for
  the paint lacquer look (decide in build; clearcoat is cheap-ish). `vehiclespecdot64` can be ignored at first
  (PBR specular replaces it) — revisit if the highlight shape matters.
- Glass materials (transparent, no MatFX): optional weak `envMapIntensity` for a subtle window reflection.

## 5. Reflection plugin (`game/plugins/vehicle-reflection/`)

- Reads the active **preset** from config and applies that strategy. Holds a registry of reflective vehicle
  materials (cars register on spawn via the LOD/spawn path, unregister on unload).
- **`source: 'sky-probe'`** (the `enhanced` path): owns a low-res **CubeRenderTarget + CubeCamera** that
  renders the **sky dome + sun only** (needs a handle to those — pass `SkyPlugin` or a "sky-only render"
  callback; keep renderware out), **regenerated only when the sky changed meaningfully** (`game.getHours()`
  crosses a ~10–15 game-min threshold, or weather change) — the main cost saver. Injects it as
  `material.envMap` + sets metalness/intensity.
- **`source: 'sa-envmap'`** (`PC`/`PS2`): swaps reflective materials to the **custom SA sphere-map shader**
  sampling `vehicleenvmap128` (from the already-loaded generic vehicle texture map); no probe render at all.
- **Switching presets at runtime** re-applies the strategy to the registered materials (rebuild/retarget
  their material setup). Preset `off`/disabled → cars keep `metalness 0` (today's look), no probe, zero cost.

## 6. Config + debug

- **`Config.graphics.vehicleReflection: { preset: keyof typeof PRESETS | 'off'; intensity: number }`**
  (+ 4 fixtures). `preset` selects the strategy; `intensity` is a live global multiplier over the preset/DFF
  values. `preset` is a plain string key → **a new preset never changes this type's shape**.
- `Game.setVehicleReflection(patch)` (nested merge like `setSky`/`setWater`).
- Debug Graphics tab (formerly "Game" screen): a **preset selector** (cycle/buttons: Off / PC / PS2 / Enhanced — generated from the
  `PRESETS` keys, so new presets show up automatically) + an INTENSITY slider (live), mirroring bloom/water.

## 7. Performance strategy

- One shared low-res cube probe (e.g. 64–128²), **updated on time change only** → amortised ~free.
- Probe renders **sky-only** (1 mesh), not the world.
- Reflective set limited to body materials flagged by the DFF (not glass/tyres) → few extra-cost draws.
- Whole feature behind `reflections.enabled`; off = today's matte cars, no probe, no envMap. Profile the
  CubeCamera regen cost in-browser; if even sky-only is too much, fall back to option A (static
  `vehicleenvmap128`, zero per-frame cost).

## 8. Layering (must hold)

- DFF plugin parsing + material translation stay in `renderware/**` (renderware types).
- `VehicleReflectionPlugin` lives in `game/**`, renderware-free — it only touches three.js objects (the cube
  probe, `THREE.Material.envMap`) and reads sky colour/sun via the same sampler closures as Sky/Water.
- canvas-host (ui) wires them, exactly like `SkyPlugin`/`WaterPlugin`.

## 9. Phases (when we build)

1. ✅ **Parser + tests — DONE.** `RwSection.MATFX/REFLECTION_MAT/SPECULAR_MAT` + `MatFxEffect` enum
   (`constants.ts`); `RWMaterial.effects` = `{ envMap?: {coefficient, texture, useFrameBufferAlpha},
   reflection?: {intensity, offset, scale}, specular?: {level, texture} }` (`types.ts`); `parseMaterial`
   reads them from the material's **Extension** (MatFX env-map incl. the embedded env-texture name, the 24-B
   reflection floats, the 28-B specular = float + char[24] name). Tests: deterministic synthetic material
   extension (negative/positive) + a gated real-asset check on `static/vehicles/admiral.dff` (coef 0.5, named
   env texture, `vehiclespecdot64`, reflection present). 303 tests green. (Reflection-plugin float order
   `scaleXY, offsetXY, intensity` confirmed on admiral; re-confirm on more cars when wiring intensity.)
2. ✅ **Preset registry + material translation — DONE.** `ReflectionPreset` + `PRESETS` (PC/PS2/enhanced) in
   `game/plugins/vehicle-reflection/presets.ts` (extensible: one entry per preset; branch on fields not name).
   `Config.graphics.vehicleReflection { preset, intensity }` (+4 fixtures, default `enhanced`),
   `Game.setVehicleReflection`. `buildMaterial` tags reflective materials with `userData.reflection` (raw DFF
   data, preset-independent); `buildVehicle` surfaces them as `BuiltVehicle.reflectiveMaterials` → `VehicleModel`.
   **`VehicleReflectionPlugin`** holds a material registry (vehicles `register`/`unregister` on spawn/despawn in
   canvas-host) and applies the preset: roughness↓ (glossier) + `envMapIntensity` from coefficient×intensity×
   preset; **metalness is gated on an env map being present** (none yet → stays matte, avoids dark PBR metal).
   Debug Graphics tab (formerly "Game" screen): "Car reflect" preset cycle (Off + registry keys) + REFLECT INTENSITY slider. **Visible
   now:** reflective body panels get a sharper sun highlight (no actual reflections until phase 3). 303 tests.
3. ✅ **`enhanced` (sky probe) — DONE.** `SkyPlugin` exposes its dome + sun on a shared **`SKY_PROBE_LAYER`**
   (1). `VehicleReflectionPlugin` owns a `WebGLCubeRenderTarget` (128, mipmapped) + `CubeCamera`
   (`layers.set(SKY_PROBE_LAYER)` → renders **sky only**), positioned at the camera, **re-rendered only when
   game-time moved ≥0.25h** (`update()` + `getHours` closure). Reflective materials get `envMap = probe.texture`
   + low metalness (dielectric paint, not chrome) + `envMapIntensity = coefficient × intensity × reflectivity`,
   so cars reflect the **real timecyc sky + sun**. `needsUpdate` only when the env-map slot toggles. 303 tests.
   Preset tuning (metalness/reflectivity/roughness) is in-browser via REFLECT INTENSITY; colour-space of the
   probe vs the dome's raw output may need a tweak (verify the reflection tint looks right).
4. ✅ **`PC`/`PS2` (SA sphere-map shader) — DONE.** `buildMaterial` resolves the DFF-named env texture
   (`vehicleenvmap128` / `xvehicleenv128` / custom per car) from the merged texture map and wires an
   **`onBeforeCompile`** injection on the reflective `MeshPhysicalMaterial`: an additive **sphere/matcap**
   reflection sampled by the **camera-space normal** (screen-locked, like `CCustomCarEnvMapPipeline`), added to
   `totalEmissiveRadiance` (after `<emissivemap_fragment>`, linear space). Gated by a `saStrength` uniform
   (holders in `userData.saReflect`) the plugin drives per preset: PC/PS2 → `coefficient × intensity ×
   reflectivity` (PC 0.7 / PS2 1.1), enhanced/off → 0. Switching presets only updates uniforms (+ recompiles
   only when the PBR env-map slot toggles). 303 tests. Strength tunable via REFLECT INTENSITY / preset
   reflectivity; an env-coord scroll could be added later but the view-normal map already moves with the camera.
5. **Config + debug + polish** — preset selector + intensity slider, runtime preset switching, glass
   reflections, profile + gate. (New presets after this = a `PRESETS` entry only.)

## 10. Open questions (confirm before/while building)

- **Default preset:** `enhanced` (best picture) vs `PC` (authentic) out of the box? (Lean `enhanced`.)
- **PC/PS2 fidelity:** ✅ **DECIDED (user) — go pixel-faithful**: build the dedicated SA sphere-map shader
  (camera-space-normal → sphere UV into the env texture, additive × coefficient×intensity) for `PC`/`PS2`,
  not a PBR approximation. Phase 4 is in.
- **Specular:** PBR (metalness/roughness/clearcoat) and drop `vehiclespecdot64`, or replicate the dot highlight
  for `PC`/`PS2`? (Could be a per-preset `specular` field.)
- **Intensity:** honour SA's subtle 0.03/0.5 verbatim (PC), or push it for PS2/enhanced via the multiplier?

## 11. Out of scope (later)

Real-time full-scene reflections (option C / SSR), reflective building windows, per-car unique env textures,
chrome animation/scroll exactly matching SA, rain wetness. The data model + plugin split are designed so each
is additive.
