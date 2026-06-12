# Road-sign text (2dfx ROADSIGN, plan 042 item 5)

`src/renderware/three/build-roadsign.ts`, dff parser type-7 entries,
`map/build-region.ts` (buildRoadsignMeshes), canvas-host font install.

## Implemented

- 2dfx type 7 parsing: plate size, rotation, flags (lines 4/1/2/3, chars/line 16/2/4/8, colour
  white/black/grey/red), 4×16-char text.
- **Entry coordinates are WORLD-space** — the only 2dfx type that is (lights are
  geometry-local). Signs therefore render as static meshes at identity per HD cell, never
  through the instanced path.
- Plate transform (solver-verified across every observed rotation family,
  `scripts/solve-roadsign.ts`): flat base (width +X, lines −Y, normal −Z), entry Euler applied
  **Z→X→Y**, angles as stored. 90°-multiple rotations satisfy several wrong conventions — never
  hand-calibrate on one junction.
- Glyphs: `roadsignfont` atlas from particle.txd (32×512; 4 cols × 32 rows of 8×16 px cells);
  cells 0–81 = ASCII minus command chars, then arrows/fractions/¢/plane/skull/icons. Command
  table (`COMMAND_GLYPHS`): `_`=space, `<`=←, `>`=→, `^`=↑, `~`=↓ (lane row,
  vanilla-verified), `}`=plane, `#`/`%`=↗/↖ (best-effort).
- Layout: fixed quarter-plate line slots, block centred vertically, `TEXT_INSET = 0.85` margin,
  width = plate/charsPerLine (authored).
- **Each glyph renders twice at ±0.05 m with identical UVs (DoubleSide)** — board face
  direction varies by rotation family; the visible-side copy hugs the board, the other stays
  buried. Readable from the front, mirrored from behind (vanilla behaviour).
- Colour-batched parts per model; meshes carry `userData.region` for picking.

## Known gaps / candidates

- `#`/`%` glyph mapping is a best-effort guess (diagonal exit arrows) — adjust the single table
  if a real board disagrees.
- Some PF-mod gantries sit slightly rotated/offset vs the vanilla entries (text can sink into
  the custom board) — data quirk, reproduces in real SA+PF.
- **Many boards are empty in vanilla too (user-verified)** — a blank board is not a bug; check
  `scripts/find-2dfx.ts` for an entry first.
- Sign text doesn't dim at night (plain unlit material, no world tint).

## Test coverage anchors

`roadsign.test.ts` (parser: vegasnroad19 + se_bit_17 regressions),
`build-roadsign.test.ts` (glyph map, quads, batching, world-space placement guard).
