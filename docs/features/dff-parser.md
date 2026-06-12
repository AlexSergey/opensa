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
- Type 7 **Roadsign**: plate size, rotation (world-space!), flags (lines/chars/colour),
  4×16-char text → sign text rendering.
- Other types (1 particle, 3 ped attractor, 6 enex, 8 trigger, 9 cover point) are skipped by
  size — counted in the survey but intentionally unused.

**Data repair (mod re-exports)**
- `sanitizeDegenerateNormals` (build side): zero-length/NaN stored OR computed normals replaced
  with face normals (PF casroyale black-faces case).
- Frame transforms are deliberately ignored for map models (SA re-frames atomic model infos);
  kept for vehicles/characters/`anim`-section clump objects.

## Known gaps / candidates

- 2dfx types 1/3/4/6/8/10 (particles, ped attractors, sun glare, enex, escalators) unparsed.
- Only the first UV layer is used downstream (second layer = lightmaps/detail in some assets).
- UV anim rotation/skew params parsed but not applied by the renderer (no asset found needing
  them yet).
- Morph targets beyond the first are ignored.

## Test coverage anchors

Real-asset fixtures under `tests/dff/`: trafficlight (backface/no normals), casroyale (zero
normals), frame-offset-ignored (junk frame), uv-anim (visagesign04), anim-clump
(nt_noddonkbase + counxref.ifp), roadsign (vegasnroad19, se_bit_17).
