# 041 — Animated map objects: UV-anim textures + IFP clump animations

## Research findings (verified on the real assets, 2026-06-12)

SA animates MAP objects (not peds) through two completely separate vanilla mechanisms:

### A. UV-animated textures — `visagesign04` (skullsign)

- The DFF **starts with a `UVAnimDict` chunk (0x2B)**: `Struct(count)` + count × `RtAnim (0x1B)`.
  Verified on visagesign04 byte-by-byte: **3 animations**, each `{ version 0x100, keyframeType
  0x1C1 (UV linear), numFrames, flags, duration f32, unused u32 }` + custom data `{ name char[32],
  nodeToUVChannelMap (32 bytes, skipped), keyframes }`. A linear UV keyframe is
  `{ time f32, uv f32[6] = (rotation, scaleX, scaleY, skew, translateX, translateY), prevFrame i32 }`.
  The three entries differ: `Material #2065564020` = 3 s / 2 kf, tx 0 → 1 (horizontal scroll);
  `Money` = 3 s / 2 kf, ty 1 → 0 (vertical scroll); `DolSign` = **1 s / 5 kf** (stepped flipbook —
  ty jumps 0 → 0.5 in paired keyframes). So the player must interpolate generic keyframe pairs,
  not assume a single 2-keyframe scroll.
- **Materials reference dict entries by name** via the UV Anim PLG (`0x135`) in the material
  extension. Both the dict and the plugin are currently **skipped** by `parseDff` (the dict skip
  was deliberate — plan 001 note).
- SA plays these as a looping transform of UV channel 0 — signs/waterfalls are mostly linear
  scrolls. The animation is global per material (all instances animate in sync) — vanilla does the
  same, which suits our InstancedMesh map perfectly.

### B. IFP-animated clump objects — `nt_noddonkbase` (des_xoilfield)

- IDE **`anim` section**: `id, model, txd, ifpName, drawDist, flags` — e.g.
  `3426, nt_noddonkbase, des_xoilfield, counxref, 200, 0x200000` (counxref.ide). Our `parseIde`
  already accepts these rows (merged with objs) but **drops the `ifpName`**.
- The DFF is a **multi-frame clump** (verified: noddonkbase has a 6-frame hierarchy — base + the
  nodding arm/counterweight). The animation lives in `<ifpName>.ifp` (we HAVE `counxref.ifp` and
  the whole family of zone IFPs — vegasw/countrye/… — extracted in `static/img/gta3`), with the
  clip named after the model and its bones bound **by DFF frame name** — the exact format
  `parseIfp` + `buildAnimationClip` (plan 012) already handle for peds.
- **Critical interplay with plan 004's frame fix:** SA re-frames only ATOMIC model infos; `anim`
  models load as **CLUMP model infos with frames preserved**. Our map path now ignores frames AND
  flattens into InstancedMesh — both wrong for this class: the nodding arm collapses into the base
  (the "part not rendering" symptom). Animated defs must take a per-instance clump path.

## Design

1. **Parsers (renderware):**
   - `ide.parser`: keep the anim name — `IdeObjectDef.anim?: string` (4th cell of `anim` rows).
   - `dff.ts`: parse `UVAnimDict` → `RWClump.uvAnimations: { name, duration, keyframes:
     { time, params[5] }[] }[]`; parse material plugin `0x135` → `material.effects.uvAnim:
     { names: string[] }` (per UV channel slot).
   - Real-asset tests: `tests/dff/uv-anim/visagesign04.dff` (3 anims, durations, material link),
     `tests/dff/anim-clump/nt_noddonkbase.dff` (+ a counxref.ifp slice — clip ↔ frame-name match).

2. **UV-anim rendering (map path).** The TXD texture cache is shared, so mutating
   `texture.offset` would scroll every user of the texture — instead the world material gets a
   `uvAnim` variant (the established `onBeforeCompile` pattern): a per-ANIMATION shared uniform
   (`{ value: Vector2/Matrix3 }`) registered in a module-level registry keyed by anim name;
   `buildWorldMaterial` wires the uniform when the RW material carries the plugin. A small
   **UvAnimSystem** (game layer; driven like the corona uniforms) advances each registered
   animation's clock (loop over `duration`) and writes the interpolated transform. Linear
   2-keyframe scrolls first; rotate/scale params only if assets need them.

3. **Animated clump objects (anim-section defs).**
   - `build-cell`/`build-region`: defs with `anim` are **excluded from instancing**; for each
     instance build a `Group` with per-atomic meshes under their **frame world transforms** (kept!),
     world materials as usual. They're rare (pumps, windmills, fans) — per-instance groups are fine.
   - Clip loading: the zone IFPs are in the big img archive (`counxref.ifp` etc.) — `getClump`-style
     cached `getIfp(archive, name)` + `buildAnimationClip`; clip looked up by model name.
   - **AnimatedObjectSystem**: one `AnimationMixer` per placed object, looping clip, `update(dt)`;
     register/unregister with cell streaming (objects belong to cells like meshes).
   - Frame-name binding: `buildAnimationClip` targets bones by name — the clump group must expose
     frame-named nodes (mirror `build-skinned-clump`'s bonesByName approach, minus skinning).

4. **Verification.** Visage sign scrolling in LV (2029.5, 1726.0); nodding donkeys pumping at the
   oil field (628.1, 1354.4); regression: pier/casino/trafficlight cases stay green (no change to
   the static path); `npm test` + in-browser sweep.

## Status

- **Iteration 1 (parsers) — DONE.** `UVAnimDict`/`RtAnim`/`UV Anim PLG` in `dff.ts`,
  `IdeObjectDef.anim` in `ide.parser.ts`; real-asset tests
  `src/renderware/parsers/binary/uv-anim.test.ts` (visagesign04 dict + material link,
  nt_noddonkbase 6 frames / 5 atomics + counxref.ifp bone↔frame-name match) and the
  counxref-format anim-row case in `ide.parser.test.ts`.
- **Iteration 2 (UV-anim rendering) — implemented.** `src/renderware/three/uv-anim.ts`:
  module-level registry (anim name → `{duration, keyframes, uniform: Vector4(offX, offY, sclX,
  sclY)}`), generic keyframe-pair lerp (equal-time pairs snap — DolSign's stepped flipbook),
  `applyWorldUvAnim` shader variant (`|uvAnim`: `vMapUv = vMapUv * scale + offset` after
  `uv_vertex`). `buildClumpParts` registers the dict + decorates plugin-carrying materials;
  `canvas-host` drives `updateUvAnimations(performance.now()/1000)` via a tiny `uv-anim` system.
  Browser check pending: scroll DIRECTION may need a sign flip (RW texture-matrix convention vs
  our UV space) — verify on the sign at (2029.5, 1726.0). **VERIFIED — the sign scrolls.**
- **Iteration 3 (IFP-animated clump objects) — implemented.**
  - `getIfp(archive, name)` cached in `asset-cache` (absent/unparseable → empty list → static).
  - `src/renderware/three/build-animated-clump.ts`: frame hierarchy KEPT — one named `Object3D`
    per frame (local transform, parented by `parentIndex`; byte-verified on nt_noddonkbase:
    root → nt_noddonkbase → Object02/04/01, Object03 under Object01), one world-material `Mesh`
    per atomic under its frame node; clip = IFP animation named after the model,
    `buildAnimationClip(…, { includeTranslation: true })` (object clips animate part positions —
    unlike ped locomotion where physics owns the root).
  - `src/renderware/three/animated-objects.ts`: mixer registry; `updateAnimatedObjects(delta)`
    skips detached roots → streamed-out cells pause, resume on re-entry.
  - `build-region.buildAnimatedObjects`: per-instance placed `Group`s (IPL conjugate-quaternion
    convention), IDE-flag treatment applied to the materials (`applyTreatment` refactored to take
    a material), `userData.region` for picking; `buildInstancedMeshes` now SKIPS anim defs;
    `buildCell` appends the animated objects. `canvas-host`: `map-animations` system drives
    `updateUvAnimations(now)` + `updateAnimatedObjects(delta)`.
  - **VERIFIED in browser at the oil field (628.1, 1354.4, 11.4)** — pumps animate correctly;
    the 1/60 ANP3 time scale and `includeTranslation: true` both check out as-is.
- **Iteration 4 (verification) — DONE.** Sign scroll direction confirmed against the ORIGINAL
  GAME (no sign flip needed — RW translate maps to our UV space directly); donkeys nod;
  regression suite green (pier/casino/trafficlight untouched — static path unchanged).

**Plan complete (2026-06-12).** Follow-up lives in plan 042 (missing objects: in-IMG text IPLs
+ procobj).

## Open questions (decide before/while implementing)

- Scope of iteration 1: just these two mechanisms end-to-end, or also sweep all `anim`-section
  defs / UVAnimDict-carrying DFFs for coverage stats first (cheap script, recommended)?
- LOD/draw-distance treatment for animated clumps (probably reuse the def drawDist with the
  HD ring only — they're all near-field props).
- Whether moving parts should also cast the dynamic-only shadow (plan 038: only dynamics cast;
  a nodding arm is a great shadow candidate — cheap to enable per animated object).

## Out of scope

Ped/vehicle animation (done elsewhere), skinned map objects (none known), physics on animated
parts, 2dfx particles, escalators/interior movers until met in data.
