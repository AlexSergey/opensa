# 002 — Uniform vehicle scale

**Status: ✅ Implemented + tested.** `--scale <factor>` grows/shrinks a vehicle uniformly while staying
internally consistent — doors/wheels/lights stay aligned, no gap when a part opens. Touches only the **visual
DFF (incl. its embedded collision)**; never the data files. One DFF in → one scaled DFF out.

**Done (`adapters/gta-sa/scale.ts`), all in the DFF:**

- **Geometry** — every geometry's positions + bounding sphere (via map-optimizer's chunk + geometry-struct
  codec). `chassis_vlo` and `_ok`/`_dam` are ordinary geometries, so they're covered.
- **Frame rig** — every `RWFrame` translation (dummies scale with the geometry → no gap).
- **Collision** — the **embedded** COL2/3/4 (correction: vehicle collision _is_ in the DFF, as the
  `0x253f2fa` plugin chunk — confirmed via the COL3 FourCC). Scaled **in place**: bounds, sphere + box
  primitives, and the int16-compressed vertices; faces/surfaces/shadow mesh left byte-identical (same length).
- **Ground lift** — scaling about the origin sinks the vehicle (the resting bottom moves to `bottom*factor`),
  so wheels dig into the asphalt (or float when shrinking). After scaling, the **whole** vehicle is lifted by
  `bottom*(1-factor)` along Z — visual parts via the **root frame** (`parentIndex < 0`; children ride it), and
  the collision. `bottom` is the embedded collision's pre-scale min-Z (the ground-contact reference). Works for
  shrink (`factor < 1` → shift down) too.

**Verified on `infernus`:** geometry verts + the `headlights` dummy scale by exactly the factor (topology
unchanged: 15 geoms / 36 frames / 3072 tris); collision radius 2.76→3.04 and bounds/spheres/vertices all ×1.1
(parsed back through the engine's `parseDffCollision`); round-trips through the real parser. The ground lift
restores the collision bottom (−0.616) at both `1.1` (root frame +0.062) and `0.95` (−0.031). Unit tests cover
`scaleFrameList`, `scaleGeometryStruct`, `scaleEmbeddedCollision`, `liftRootFrames`, `liftEmbeddedCollision` +
the end-to-end bottom-restore (14 tests). End-to-end CLI writes `out/<filename>.dff`.

> Note: collision vertices are int16/128, so scaling rounds to ~8 mm — negligible for physics. The shadow mesh
> (cosmetic vehicle-shadow silhouette) is left at original scale; add later if a large scale makes it visible.

## What gets scaled (everything visual, by the same factor `s`)

- **All geometry vertices** — every `RWGeometry.positions × s`: body, `chassis_vlo`, wheels, doors, and the
  `_ok` / `_dam` damage parts. Recompute each geometry's **bounding sphere**.
- **The whole frame rig** — every `RWFrame.position × s` (rotations unchanged). This is the key to "no gap":
  the dummies (wheel/door/seat/light hinges) move outward by the **same** `s` as the geometry, so their relation
  to the parts is preserved — a door opens exactly as before, just bigger. (Freezing dummies would cause the
  offset; scaling them with the geometry is what avoids it.)
- **Collision** — the vehicle's COL (vertices, bounding box/sphere, and any sphere/box primitives × `s`). SA
  vehicle collision lives in a COL file/section keyed by model — scale that entry.

## Explicitly NOT touched (per the request)

`vehicles.ide`, `carcols`, `handling.cfg` — wheel scale, dimensions, mass, centre-of-mass, etc. stay as-is. (So
a data-driven wheel size may not perfectly match a large `--scale`; accepted — out of scope.)

## How

- **DFF:** read the RW chunk tree (map-optimizer's faithful container codec); scale the **Frame List**
  translations; scale each Geometry **Struct**'s positions + recompute bounds (map-optimizer's geometry-struct
  codec); re-encode. Vehicles are hierarchical atomics (not bone-skinned), so no skin remap — and the vertex
  **count is unchanged**, so this rides the attribute-overlay path (no topology rebuild).
- **COL:** the collision is the `0x253f2fa` plugin **leaf inside the DFF** (a COL2/3/4 library). Scale it **in
  place** — no parse/re-serialize, no separate file — so faces/surfaces/shadow mesh/structure stay byte-identical
  and only the numeric geometry (bounds, sphere/box primitives, int16 vertices) changes. Offsets follow
  `parsers/binary/col.ts` (offsets relative to the size field, `OFFSET_BASE = 4`; vertex count = max face index
  - 1; vertices int16/128).

## Reuse vs. new

- **Reuse:** `../src` RW DFF + COL parsers (read-only, for verification); **`../map-optimizer`** chunk codec +
  geometry-struct codec.
- **New:** **Frame List scale** (`RWFrame.position` in the frame-list leaf); **in-place embedded-COL scale**
  (no writer — mutate the numeric fields); the `process` scale path + output write.

## Risks

- **Frame-list write** — must scale translations only (leave rotations + hierarchy intact), or the rig breaks.
- **In-place COL offsets** — get a section offset wrong and the collision corrupts; mitigated by following the
  parser's layout + the round-trip check via `parseDffCollision`. Shadow mesh left unscaled (cosmetic).
- **Int16 vertex quantization** — collision verts round to ~8 mm; negligible.
- **Bounds** — stale bounding spheres cause culling/physics glitches; scaled (uniform scale → sphere × factor).
- **Data mismatch** — `wheelScale`/`handling` untouched (accepted); note it so a very large scale's wheels/physics
  may need a manual data tweak by the modder.
- **Verification** — in-game: open every door/boot/bonnet (alignment), wheels seated, collision sane.

## Scope

- **In:** uniform scale of all geometry (incl. `chassis_vlo`, `_ok`/`_dam`) + the full frame rig + collision;
  bounds recompute; emit DFF (+ COL).
- **Out:** data files (`vehicles.ide`/`carcols`/`handling.cfg`); non-uniform/axis scale; geometry topology
  changes.
