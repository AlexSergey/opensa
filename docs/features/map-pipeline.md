# Map pipeline (DAT / IDE / IPL → streaming world)

`src/renderware/parsers/text/`, `src/renderware/map/`, `src/game/streaming/`,
`src/game/adapters/gta-sa-world.adapter.ts`.

## Implemented

**Text parsers**
- `gta.dat` (IDE/IPL/IMG directives).
- IDE: `objs` (incl. the mesh-count multi-draw-distance variant — max wins), `anim` (IFP name
  kept on `def.anim`), `tobj` (time windows), `txdp` (TXD parents). Other sections ignored.
- IDE flags (`ide-flags.ts`): DRAW_LAST, ADDITIVE, NO_ZBUFFER_WRITE, no-shadow (moot),
  IS_TREE/IS_PALM, DISABLE_BACKFACE_CULLING — full render-relevant set per the flag histogram.
  NO_ZBUFFER_WRITE (0x40) is applied only to **transparent** materials (decals/shadows/glass, which
  always also carry DRAW_LAST) — opaque geometry keeps depth writes, else bare-0x40 countryside
  terrain tiles show through under a free camera (plan 039 follow-up).
- IPL `inst` (11 columns), interior **area codes** (`interior & 0xFF`, world ids {0, 13}).
- Binary `bnry` IPL streams (full-detail placement) + **standalone script-gated groups**
  (`resolveMap({ extraIpl })`, default `['truthsfarm']`; barriers/carter/crack deliberately
  off — our world-state choice).
- zones (`info.zon`, `map.zon`), water.dat, timecyc(+24h), carcols, handling, vehicles.ide,
  procobj.dat, surfinfo.dat, GXT (CRC-32 without final inversion).

**World assembly**
- `resolveMap`: catalog + timed catalog + txdp + all instances (text + streams + extras).
- `buildWorldGrid`: 250 m cells, HD vs LOD lists (`isLodModel` by name), exterior filter.
- `buildCell` per cell: **InstancedMesh per single-material part** (shared geometry attributes),
  per-def IDE-flag treatment, timed-object gating (`TimedObjectSystem`), 2dfx corona collection
  (HD only), animated `anim`-section objects (per-instance groups), road-sign text meshes,
  procobj clutter.
- Map meshes ignore DFF frame transforms (SA re-frames atomic model infos — junk-frame proof).
- `StreamingSystem`: HD ring within `hdDrawDistance`, LOD ring to `lodDrawDistance`, async cell
  loads cached by the adapter, `CellFader` fade-in, manual cell selection for the map viewer.
- Picking/describe: `userData.region` (instanced map), `userData.procObj` (clutter).

## Known gaps / candidates

- IPL sections `cull`, `enex`, `grge`, `pick`, `jump`, `tcyc`, `auzo`, `mult`, `occlu` ignored.
- Interiors are filtered out entirely (no interior worlds yet).
- `anim`-def draw distance uses the normal HD ring only (fine for the rare props).
- No occlusion culling (SA `occlu`); frustum culling only.

## Test coverage anchors

Parser tests per format; `build-region.test.ts` (flags, frame-offset regression, decoratePart),
`build-cell.test.ts`, `world-grid.test.ts`, `resolve-map.test.ts` (extraIpl),
`streaming.system.test.ts`, `fade.test.ts`, `grid.test.ts`.
