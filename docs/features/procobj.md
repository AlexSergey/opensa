# Procedural ground clutter (procobj, plan 042)

`packages/renderware/src/parsers/text/procobj.parser.ts`, `surfinfo.parser.ts`,
`packages/renderware/src/map/procobj-*.ts`, `build-procobj.ts`, adapter integration, debug ProcObj
screen.

## Implemented

- `procobj.dat` parsing (~95 rules, 18 `P_*` surfaces, 14 columns) and `surfinfo.dat` surface
  table (**row order = COL material id**, 179 rows; the `P_*` rows ARE the procobj surface
  names — no extra mapping).
- Deterministic per-cell scatter over collision faces: mulberry32 seeded by cell coords; world
  triangles from COL verts × placement matrices; area-weighted counts; sqrt-warped barycentric
  points; rule ranges for rotation/scaleXY/scaleZ/z-offset; face normal kept (align), flipped
  up when winding points down (upside-down-bushes fix).
- **Lottery mechanism**: 3× vanilla candidates with `lottery ∈ [0,3)`, sorted → live density
  slider = instance-count cutoff, no cell rebuild.
- Semantic categories (grass/flowers/bushes/cacti/trees/rocks/underwater; sea floor overrides
  to underwater) with per-category `{enabled, drawDistance, density}` in `graphics.procobj` +
  debug **ProcObj** screen.
- **One `procObjLimit` (default 150/cell)** caps BOTH rendering and collision via the cell-wide
  lottery threshold; vanilla pools at ~300 for the same physics-cost reason.
- Collision = rendered set ∩ models that ship a COL (rocks/cacti/trees collide; grass/flowers
  walk-through); knob changes re-stream physics (debounced invalidate + reload).
- Wind mod's `decoratePart` runs on clutter parts (procedural bushes sway when listed).
- Clutter is pickable (`describe` reads `userData.procObj`); offline sanity tool
  `scripts/procobj-stats.ts`.

## Known gaps / candidates

- `useGrid` column unimplemented (no vanilla rule uses it).
- Vanilla's create-around-camera MINDIST behaviour intentionally replaced by per-category
  drawDistance + per-cell budget.
- Density defaults left at 1 (authored) — the per-cell limit dominates.

## Test coverage anchors

`procobj.parser.test.ts` (incl. shipped-file invariants), `procobj-scatter.test.ts`
(determinism, counts, normal flip, lottery cap), `procobj-runtime.test.ts`,
`procobj-colliders.test.ts`, `build-procobj.test.ts`.
