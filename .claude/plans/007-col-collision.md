# COL collision — parse RenderWare collision + bind to placed objects

> **Status: Phases 0–5 DONE** (parse → index → bind → debug overlay → physics seam). 127 tests green,
> tsc + eslint + `vite build` clean. Only the browser visual acceptance of the collision overlay (Phase 4)
> and **Phase 6 — Rapier physics (separate plan 008)** remain.

## Data check — DONE, data is present and sufficient ✅

> The user re-packed the `.col` files into the **main** `static/models/gta3.img` (not a separate archive).
> Verified directly from the archive directory:
> - **215 `.col` library files**, totalling **8061 collision models**.
> - Versions: **COL2 = 762, COL3 = 7299** (no COL1/COL4 in this set).
> - **100% (8061/8061)** of collision-model names have a matching `.dff` in the same archive → **binding by
>   model name is exact**; nothing missing.
> - Archive now: `.dff` 12217, `.txd` 2163, `.col` 215 (`gta3.img` ≈ 758 MB, magic `WIMG0001`).
>
> Consequence vs the original sketch: **no separate `coll.img`, no second download.** The collision index
> is built from the **already-in-memory `ImgArchive`** (`*.col` entries) the model loader already holds.
> Earlier "100% / clean names" caveat: the COL `name` field is a fixed **22-byte, NUL-terminated** string —
> terminate at the first `\0` (a naive 22-byte read shows trailing field bytes; see gotcha #6).

In GTA SA, map collision lives as **`.col` files inside the IMG archive** (alongside DFF/TXD). Each `.col`
entry is a **collision library**: a sequence of FourCC-tagged collision models, each **named to match a
DFF model**. Binding is therefore by **model name** (lowercased), exactly like `modelKey`/`getClump`.
(`COLFILE` in `gta.dat` is only for the non-streamed peds/vehicles/weapons/generic libs — not the map.)

In GTA SA, map collision lives as **`.col` files inside the IMG archive** (alongside DFF/TXD). Each `.col`
entry is a **collision library**: a sequence of FourCC-tagged collision models, each **named to match a
DFF model**. Binding is therefore by **model name** (lowercased), exactly like `modelKey`/`getClump`.
(`COLFILE` in `gta.dat` is only for the non-streamed peds/vehicles/weapons/generic libs — not the map.)

## Goal & scope

1. **Parse** RenderWare COL (COL1/COL2/COL3, COL4 best-effort) into a renderer-agnostic data model:
   bounds + spheres + boxes + a **triangle mesh** (vertices + faces + surface material).
2. **Bind** each placed instance (`IplInstance` → `IdeObjectDef.modelName`) to its collision model by name,
   producing per-model collider data with the instance world transforms (same conjugated-quat convention
   as rendering).
3. **Prove it** without physics: a **"Show Collision"** debug toggle that overlays collision wireframes
   exactly on the rendered models (correct shape / place / orientation = parser + binding verified).
4. **Carve the seam** so the future Rapier `PhysicsSystem` (plan 008) consumes ready collider data.

Out of scope here (own follow-ups): Rapier physics, bitECS character, collision **streaming** by region,
shadow-mesh (COL3) lighting, COL surface-material gameplay semantics, interiors collision.

## Layers (respect the game ↔ renderware boundary)

```
src/renderware/
  parsers/binary/
    col.ts            # parseColLibrary(ArrayBuffer) -> ColModel[]   (new; pure, no three)
    col-types.ts      # ColModel/ColSphere/ColBox/ColFace/ColSurface (or fold into types.ts)
    col.test.ts
  collision/
    collision-index.ts    # buildCollisionIndex(archive) over the EXISTING gta3.img -> Map<name, ColModel>
    build-colliders.ts    # mirror build-region: filter+group instances, bind by name -> RegionColliders
    index.ts
  three/
    build-col-wireframe.ts  # ColModel -> THREE.LineSegments/InstancedMesh wireframe (debug overlay)
  index.ts            # export the new public surface
src/game/
  interfaces/world-adapter.interface.ts  # + loadCollisionDebug() (and later loadColliders())
  adapters/gta-sa-world.adapter.ts        # implement via renderware/collision (only importer)
  collision/collision-world.ts            # CollisionWorld holder (name->shape + transforms) for physics
```

`three` stays the shared substrate; only `game/adapters/**` imports `renderware`. COL is **not** RW-chunked
(no 12-byte chunk headers) — it's its own FourCC library format, so `col.ts` walks blocks manually over
`BinaryStream` (reuse `parsers/binary/binary-stream.ts`); it does **not** use `chunks.ts`.

## COL binary format (implementation reference)

**Observed in our archive:** only **COL2** and **COL3** appear (no COL1/COL4) — implement those two
fully; COL1/COL4 are best-effort/skip. A `.col` file = concatenation of N models. Walk by repeatedly
reading a **FileHeader** then jumping `8 + size` bytes to the next:

```
FileHeader (8 bytes):
  char   fourcc[4];   // "COLL"(v1) | "COL2"(v2) | "COL3"(v3) | "COL4"(v4)
  uint32 size;        // bytes that FOLLOW these 8 (i.e. body length); next model at pos + 8 + size
```

Body common prefix:
```
char    name[22];     // NUL-padded; lowercase it for the index key
uint16  modelId;
TBounds bounds;       // 40 bytes, layout differs by version (see below)
```

`TBounds` (10 floats = 40 bytes):
- **COL1**: `radius(1f), center(3f), min(3f), max(3f)`
- **COL2/3/4**: `min(3f), max(3f), center(3f), radius(1f)`

### COL1 body (full inline data)
```
uint32 numSpheres;  TSphere[ ]   // radius(f), center(3f), TSurface(4 bytes)
uint32 numUnknown;               // skip (unused)
uint32 numBoxes;    TBox[ ]      // min(3f), max(3f), TSurface(4)
uint32 numVertices; float verts[3]
uint32 numFaces;    TFaceV1[ ]   // a,b,c (uint32), TSurface(4)
```

### COL2/3/4 body (counts + section offsets) — VERIFIED against the real archive
Body offsets shown (header data starts at @64, right after name[22]+modelId(2)+bounds(40)):
```
@64  uint16 numSpheres;
@66  uint16 numBoxes;
@68  uint32 numFaces;
@72  uint32 flags;              // COL2 saw 2, COL3 saw 10; not needed — read & ignore
@76  uint32 offsetSpheres;
@80  uint32 offsetBoxes;
@84  uint32 offsetCones;        // (lines; unused — read & ignore)
@88  uint32 offsetVertices;
@92  uint32 offsetFaces;
// COL3/COL4 only (present but not needed):
@96  uint32 numShadowFaces;
@100 uint32 offsetShadowVertices;
@104 uint32 offsetShadowFaces;
```
**Offset base = body start − 4**: `bodyPos = storedOffset − 4` (offsets are relative to the FourCC
`size` field, 4 bytes before the body). Confirmed: COL2 boxes stored 104 → body 100; COL3 verts
stored 116 → body 112; COL3 faces stored 684 → body 680 (ends exactly at body length).

Section data (seek to `storedOffset − 4`):
- **Spheres**: `center(3f), radius(f), TSurface(4)`  (20 bytes)
- **Boxes**:   `min(3f), max(3f), TSurface(4)`        (28 bytes)
- **Vertices**: **int16[3] / 128.0** (6 B, compressed) for **both COL2 and COL3** in this archive —
  *corrected from the original sketch*: float verts are COL1 only (absent here). Count is **not stored**
  → derive `numVertices = max(face index) + 1` (a gap of cones/face-group bytes can sit between the
  vertex and face sections, so `(offFaces − offVertices)/stride` is unreliable).
- **Faces**: `uint16 a,b,c; uint8 material; uint8 light;` (8 bytes)
- `TSurface` = `uint8 material, flag, brightness, light` (4 bytes)

### Known gotchas (verify against real assets via skipIf tests)
1. **Offset base (the #1 trap):** in COL2/3/4 the section offsets are relative to the position of the
   `flags` field's frame — concretely, base = `(offset of fileSize field) + size_already_read`. Different
   parsers use "start of body after the 8-byte FileHeader **minus 4**". Pin this down empirically: parse a
   known model and assert vertex[0]/face[0] match a reference. Encode the resolved base as a constant.
2. **Compressed vertices** are COL3+ only (int16/128). COL2 is float. Branch on FourCC.
3. **Version detect** strictly by FourCC; a library can mix versions across models.
4. **Empty models**: `flags` "not empty" bit clear ⇒ zero faces; bind nothing (some props are sphere-only).
5. **Bounds order flips** between COL1 and COL2+ (above) — easy to read swapped.
6. **Name field** is 22 bytes, NUL-terminated — cut at the first `\0` (don't keep the full 22 bytes;
   verified: doing so drags in `modelId`/bounds bytes and breaks the name key).

## Binding to objects (the actual "binding")

Mirror `build-region.ts`:
- Inputs: the collision index (`Map<name, ColModel>`) + `MapDefinitions` + the same `RegionRequest`
  (`center`, `radius`; **`geometry` is irrelevant** — LOD models have no collision, so bind only
  non-LOD real models, `!isLodModel(def.modelName)`).
- For each instance: `def = catalog.get(id)`; `interior === 0`; in radius; `col = index.get(def.modelName)`
  (skip if none). Group by model name.
- Emit `RegionColliders = { name, col: ColModel, transforms: Matrix4[] }[]`, each transform composed from
  the instance `position` + **conjugated** `rotation` quaternion (identical to the render matrix — so the
  wireframe lands exactly on the mesh).

**Coordinate convention:** collision verts are GTA **Z-up**, like the models. Debug wireframes go in the
**same group** the adapter rotates by −90°X, so they overlay perfectly with no extra math. For physics
(plan 008) bake `−90°X × instanceMatrix × vertex` into **Y-up world space** trimeshes — keep that
conversion at the physics seam, not in the parser.

## Engine seam (game layer)

- `WorldAdapter`: add `loadCollisionDebug(request): Promise<Object3D[]>` (now) and reserve
  `loadColliders(request): Promise<RegionColliders>` (physics later).
- `GtaSaWorldAdapter`: `prepare()` also loads the collision archive + builds the index (idempotent like
  today); `loadCollisionDebug` = `buildColliders(index, defs, req)` → `buildColWireframe` per model →
  one InstancedMesh of wireframe per model, wrapped in the same −90°X group.
- `Game`: a `CollisionWorld` field (name → shape + instance transforms) populated alongside `loadGame`,
  ready for `PhysicsSystem`; `setConfig({ showCollision })` adds/removes the debug overlay group;
  track separately from `worldObjects` so it disposes on region reload.
- Debug overlay: a third radio/checkbox group **"COLLISION: Show / Hide"** → `game.setConfig({showCollision})`.

## Data acquisition (Phase 0 — ✅ DONE by the user)

The user already re-packed the `.col` files into **`static/models/gta3.img`** (the main WIMG archive),
verified above (215 libs / 8061 models). **No further acquisition, no separate `coll.img`, no second
download.** The collision index is built from the in-memory `ImgArchive` the model loader already holds
(`getCollision` reads `*.col` entries by name). `gta.dat`'s `IMG models\gta3.img` line is unchanged.

(For reproducibility, if the archive is ever rebuilt: re-pack including `.col` — extend `pack-img.mjs`
`KEEP` with `.col` or run `pack-img.mjs --all` over a source folder that contains the `.col` files. That
source must come from the original SA `gta3.img`; it cannot be synthesized.)

## Phased plan (each phase keeps `npm test` + the app green)

0. ✅ **Data acquired.** `.col` re-packed into `static/models/gta3.img` (215 libs / 8061 models). Done.
1. ✅ **COL parser — DONE.** `parsers/binary/col.ts` (`parseColLibrary`) + `col-types.ts` + `col.test.ts`
   (synthetic COL2/COL3 builders + real-archive smoke tests reading single `.col` entries from `gta3.img`,
   `skipIf` archive missing). Added `BinaryStream.i16()` + `test-utils.i16()`; exported from the barrel.
   Offset base pinned (−4). 99 tests green, tsc + eslint clean.
2. ✅ **Index — DONE.** `collision/collision-index.ts` — `buildCollisionIndex(archive)` walks every `*.col`
   entry in the existing `ImgArchive` once → `CollisionIndex` (`Map<lowercased name, ColModel>`), cached
   per archive via a `WeakMap` (first-name-wins; parse failures skipped). `getCollision(index, name)` for
   binding. `collision/index.ts` barrel + re-export from `renderware/index.ts`. 6 unit tests (stub
   archives), 105 total green, tsc + eslint clean.
3. ✅ **Binding — DONE.** `collision/build-colliders.ts` — `buildColliders(index, defs, { center, radius })`
   mirrors `buildRegion`: filter (`interior === 0`, radius, **non-LOD**), group by model name, look up via
   `getCollision`, emit `RegionColliders[]` = `{ col, name, transforms: Matrix4[] }` (position + conjugated
   IPL quat, unit scale, **no per-part frame matrix** — COL verts are model-space). 8 unit tests (stub
   index + `MapDefinitions`), 113 total green, tsc + eslint clean.
4. ✅ **Debug visualization — DONE (code; browser acceptance pending user).** `three/build-col-wireframe.ts`
   (`buildCollisionWireframe(colliders)` → one `LineSegments`: tri edges + box edges + sphere rings, each
   model transformed per placement); `WorldAdapter.loadCollisionDebug` + `GtaSaWorldAdapter` impl (wraps in
   the −90°X group); `Config.showCollision`; `Game.setShowCollision` + `refreshCollision` (tracks
   `collisionObjects` + `lastRequest`, rebuilds on region reload, disposes on toggle-off; `disposeObject`
   generalized to `LineSegments`); debug-overlay **COLLISION: Show/Hide** group. 6 wireframe unit tests,
   119 total green; tsc + eslint + `vite build` clean. **Browser acceptance:** Ctrl+D → COLLISION: Show on
   Ganton → green wireframes overlay the buildings/props (first toggle builds the index once, ~8061 models).
5. ✅ **Physics seam — DONE.** Generic engine-side collider DTOs in `game/interfaces/collider.interface.ts`
   (`ModelColliders` = `{ name, shape: { vertices, indices, boxes, spheres }, transforms: Matrix4[] }`) — no
   renderware types leak into `game`. `WorldAdapter.loadColliders(request): Promise<ModelColliders[]>`
   reserved + implemented in `GtaSaWorldAdapter` (`toModelColliders` converts `RegionColliders`/`ColModel`
   → DTO; the only place bridging the two). `game/collision/collision-world.ts` `CollisionWorld` holder
   (`models`/`placementCount`/`set`/`clear`). `Game.getCollisionWorld()` + `Game.loadColliders()` populate it
   for the current region; `loadGame` clears it (region-scoped). **Deviation from sketch:** not auto-built in
   `loadGame` — explicit `loadColliders()` avoids parsing all 8061 `.col` on startup before any physics
   consumer exists; a `PhysicsSystem` calls it. Boundary holds (eslint clean; only `game/adapters/**` imports
   renderware). 8 unit tests (`CollisionWorld` + `toModelColliders`), 127 total green; tsc + eslint + build clean.
6. **(Separate plan 008)** Rapier `PhysicsSystem`: bake static trimesh colliders to Y-up world space,
   kinematic character controller; consumes `CollisionWorld`. Collision **streaming** rides on the
   StreamingSystem (plan 006 phase 6).

## Testing

- **Parser:** vitest, node env; synthetic COL1/2/3 byte buffers (extend `renderware/test-utils.ts` with a
  `colModel()` builder); real-asset asserts `skipIf` missing. Assert counts, first/last vertex, a known
  face, bounds, surface material, compressed-vertex decode.
- **Index/bind:** stub archive + stub `MapDefinitions`; assert name binding, radius/interior/LOD filtering,
  transform == render transform (conjugated quat) for a fixed instance.
- **Integration:** Playwright collision-overlay toggle (visual correctness = parse+bind+orientation).
- **Boundary:** eslint `no-restricted-imports` (game→renderware only via adapters) — no runtime test.

## Open decisions

- ✅ **Separate `coll.img` vs re-pack `gta3.img`** — RESOLVED: re-packed into the main `gta3.img`; the
  index reads `*.col` from the already-loaded archive (no second download).
- **Eager full index at `prepare()` vs lazy per-library** — recommend **eager** (collision data is small,
  parse-all-once is simplest; lazy/region-streamed is a phase-6 optimization with a model→library manifest).
- **Debug wireframe primitive** — `LineSegments` (true wireframe, clearest) vs translucent `InstancedMesh`
  (cheaper for repeated props). Recommend `LineSegments` for trimesh + box/sphere helpers; revisit if the
  full-map overlay is too heavy (it's debug-only).
- **`ColModel` granularity** — keep spheres/boxes/trimesh all in the model; physics picks per shape later.
```
