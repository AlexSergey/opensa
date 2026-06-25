# Animated map objects (plan 041)

`packages/renderware/src/three/uv-anim.ts`, `build-animated-clump.ts`, `animated-objects.ts`,
`map/build-region.ts` (buildAnimatedObjects), canvas-host `map-animations` system.

## Implemented

**UV-animated textures** (signs, waterfalls — e.g. the LV skull sign `visagesign04`)

- UVAnimDict parsed from the DFF; materials reference entries by name (UV Anim PLG).
- Module registry: one shared `Vector4(offX, offY, sclX, sclY)` uniform per dict entry — the
  TXD texture cache is shared, so `texture.offset` is never mutated; all instances animate in
  sync (vanilla behaviour).
- Generic keyframe-pair lerp looping over the duration; equal-time key pairs snap (stepped
  flipbooks like `DolSign`). Scroll direction verified against the original game (no flip).
- World-material shader variant `|uvAnim` (`mapUv = mapUv * scale + offset` after `uv_vertex`).

**IFP-animated clump objects** (IDE `anim` section — oil pumps, windmills, fans)

- `anim` defs are excluded from instancing; each instance builds a **frame hierarchy with
  transforms KEPT** (the one exception to the map's frames-ignored rule), one world-material
  mesh per atomic under its named frame node.
- The clip comes from `<def.anim>.ifp` (cached `getIfp`), named after the model, bones bound by
  frame name; `includeTranslation: true` (object clips animate part positions).
- Mixer registry: `updateAnimatedObjects(delta)` skips detached roots — streamed-out objects
  pause and resume on re-entry. IDE-flag treatment applies to the materials (e.g. the pump's
  0x200000 double-sided).

## Known gaps / candidates

- Moving parts don't cast the dynamic shadow (cheap to enable per object — open note).
- Moving parts have no animated collision.
- ANP3 time scale is the ped-tuned 1/60 (verified fine on the pumps).

## Test coverage anchors

`uv-anim.test.ts` (registry/interp/shader/real asset), `roadsign.test.ts` shares the 2dfx walk,
`build-animated-clump.test.ts` (hierarchy/clip binding), `build-animated-objects.test.ts`
(placement, mixer pause, treatment), `ide.parser` anim rows, `ifp` parser tests.
