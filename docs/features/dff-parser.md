# DFF parser

`src/renderware/parsers/binary/dff.ts` (+ `binary-stream.ts`, `chunks.ts`, `constants.ts`,
`types.ts`). Renderer-agnostic: outputs plain `RWClump` data, three.js never leaks in.

## Implemented

**Clump structure**
- Chunk-tree walking (`[type u32][size u32][version u32]` LE headers), tolerant of unknown
  chunks (skipped by size).
- FrameList: name (NodeName plugin), parent index, 3×3 rotation + position.
- GeometryList / Geometry: positions, normals, up to N UV layers (first used), triangles with
  per-face material index, day prelit RGBA, **SA night prelit RGBA** (Extra Vert Colour plugin
  `0x253F2F9`), bounding data.
- Atomics (frame ↔ geometry links).
- BinMeshPLG fallback: when every face has material index 0 but BinMesh carries the real
  per-material split, the assignment is recovered from it.
- Skin plugin: bone indices/weights, inverse bind matrices, used-bone remap (peds).
- Leading **UVAnimDict** (`0x2B`/RtAnim `0x1B`, keyframe type `0x1C1`): named UV animations
  with `{time, (rot, sx, sy, skew, tx, ty)}` keyframes.

**Material data**
- Colour, texture refs (name + mask).
- MatFX env-map (coefficient, texture, FB-alpha flag).
- SA reflection plugin (`0x253F2FC`): env UV scale/offset, intensity.
- SA specular plugin (`0x253F2F6`): level + texture.
- UV Anim PLG (`0x135`): channel mask + per-channel dict-entry names.

**2d Effect plugin (`0x253F2F8`, geometry extension)**
- Type 0 **Light**: colour, corona far-clip/size, flags, corona texture → street-lamp coronas.
- Type 1 **Particle**: char[24] FX-system name (effects.fxp) + geometry-local position →
  data-driven emitters (plan 044).
- Type 7 **Roadsign**: plate size, rotation (world-space!), flags (lines/chars/colour),
  4×16-char text → sign text rendering.
- Type 10 **Escalator**: geometry-local path (start/bottom/top/end) + direction → moving step
  rows (plan 044).
- Other types (3 ped attractor, 6 enex, 8 trigger, 9 cover point) are skipped by
  size — counted in the survey but intentionally unused.

**Breakable plugin (`0x253F2FD`, geometry extension; plan 045)**
- `RWGeometry.breakable`: the secondary "shatter" mesh (positions/UVs/colours, triangles +
  per-triangle material, materials with texture/mask/ambient). Magic 0 = 4-byte marker, not
  breakable (1695 models carry the chunk, 238 have real data); non-zero magic is a raw runtime
  pointer, not a flag. Layout byte-verified: header + packed arrays sum to the chunk size
  exactly — anything else is refused (data-tolerant undefined).

**Data repair (mod re-exports)**
- `sanitizeDegenerateNormals` (build side): zero-length/NaN stored OR computed normals replaced
  with face normals (PF casroyale black-faces case).
- Frame transforms are deliberately ignored for map models (SA re-frames atomic model infos);
  kept for vehicles/characters/`anim`-section clump objects.

## Coverage (audit 2026-06-12, `scripts/audit-rw-coverage.ts`)

**13126 DFFs, 0 parse failures.** Full 2dfx census: lights 1664 (done), particles 113,
ped attractors 820, sun glare 2, enex 75, roadsigns 516 (done), trigger 30, cover points 13900,
escalators 6. Notable unparsed chunks present in data: HAnimPLG ×10948, **Breakable**
(`0x253F2FD`, gtamods-confirmed) ×1724, PipelineSet ×27, Right To Render ×56k (pipeline hint —
harmless skip), RW core Light sections ×912 (SA ignores them); 316 models carry a second UV
layer.

## Known gaps / candidates (prioritized in plan 043)

- Second UV layer unused downstream (suspected MatFX dual-pass dirt/detail — investigate).
- HAnim PLG unparsed — bones bind by frame name (works for shipped data; IDs are more robust).
- Breakable parsed (plan 045 iteration 1); the break gameplay (debris, triggers) is the rest
  of plan 045.
- 2dfx types 3/4/6/8/9 — explicitly N/A (gameplay/AI/interiors out of scope).
- UV anim rotation/skew params parsed but not applied (no shipped asset animates them).
- Morph targets beyond the first ignored (MorphPLG absent from shipped data).

## Test coverage anchors

Real-asset fixtures under `tests/dff/`: trafficlight (backface/no normals + raw-pointer-magic
breakable), casroyale (zero normals), frame-offset-ignored (junk frame), uv-anim
(visagesign04), anim-clump (nt_noddonkbase + counxref.ifp), roadsign (vegasnroad19 — also the
zero-magic breakable marker, se_bit_17), particle (skullpillar01_lvs), escalator (escl_la +
esc_step), breakable (binnt08_la).
