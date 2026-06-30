# 001 — sa-lod: architecture & API

**Status: ✅ As-built (shared library).** `@opensa/sa-lod` is a `type:tool` **library** (no CLI): the
**simplified-copy LOD mesh pipeline** — QEM decimation, smooth-normal rebuild, and RenderWare DFF/TXD/COL encode
from a merged mesh. Extracted from `opensa-lod-generator`'s adapter (+ a new `mesh.ts` types module) — see
`lod-procobj-generator` [001 §extraction, phase 3](../../../lod-procobj-generator/docs/plans/001-architecture.md).
(The JSDoc "plan 002 / plan 015" references in the source point at **`opensa-lod-generator`'s** plans, where these modules
originated.)

## Why it exists

Two tools make "simplified copy" LODs — `opensa-lod-generator` (per merged **cell**) and `lod-procobj-generator` (per
**species** model). Both feed a mesh through the **same** transforms (decimate → re-normal → encode) and the same
SA-strict encoders. That pipeline lives here so both import it; `tool-kit` stays generic (pure mesh ops), this
package adds the **RenderWare encode** knowledge.

Layering: `@opensa/rw-codec` + `@opensa/tool-kit` (bytes / generic mesh) → `@opensa/renderware` (read) →
**`sa-lod`** (SA encode) → the LOD tools. Pure TS, deterministic, no GL/native deps. Sits beside `map-placement`
(map-edit workflows) under `tools/`.

## The interchange: `MergedMesh`

`./mesh` defines the contract. A **producer** (a cell merge in `opensa-lod-generator`; a single frame-baked model in
`lod-procobj-generator`'s `mesh-builder.ts`) builds a `MergedMesh`: native **Z-up** space, triangles bucketed into
per-texture `MergedGroup`s (no atlas), vertex attributes as parallel arrays indexed by the group `indices`. Normals
ride from the source when present (else zero, for the normals pass); colours default to opaque white when a source
vertex had no prelit. `sa-lod` consumes it; it does not produce it (each tool owns its own merge/build granularity).

## Public API (`exports`)

### Transforms

- `./decimate` — `decimateMesh(mesh, targetTriangles)` — QEM edge-collapse via `@opensa/tool-kit/mesh/simplify`.
  Each per-texture group is a face group, so collapses across texture seams / the open silhouette are **pinned**
  (far contour + material edges survive). Two guards keep the far view clean: an **edge-length cap**
  (`maxEdgeFactor` 1.5 — no flat-surface spikes) and a **per-group floor** (`minFacesPerGroup` 2 — no vanishing
  surfaces). UV + colour (+ night) interpolate along; normals are dropped (re-derived next). Vertices are **not**
  welded (welding smears textures across UV seams / collapses stacked terrain). A mesh already under budget is
  returned unchanged.
- `./normals` — `rebuildMeshNormals(mesh, options?)` — re-derive normals from smooth groups via
  `@opensa/tool-kit/mesh/smooth-normals` (flat stays flat, edges stay sharp — the merged source normals are
  dropped by `decimate`). Flattens all groups for adjacency, rebuilds, splits back; attributes grow to match the
  split vertices.

### Encoders (SA-strict)

- `./encode-dff` — `encodeLodDff(mesh, name, options?)` → a standard SA RenderWare DFF: a multi-material geometry
  (one material per texture group) + a **BinMesh PLG** (so the real game renders the splits), native Z-up
  cell/model-local space (the IPL `inst` places it). **Optionally two-sided** (`options.doubleSided`, each triangle
  both windings — indices only): the cell-LOD tool (OpenSA-only) enables it so OpenSA's back-face culling doesn't
  hole a merged cell's inconsistently-wound ground; single-sided by default, which the real game wants for a single
  authored model (e.g. a procobj impostor). u16 indices cap a geometry at 65 535 verts, so a dense mesh is **split
  across several geometries/atomics** in the one clump (`splitMesh`), all sharing the identity frame.
- `./encode-txd` — `encodeLodTxd(textures, source, maxSize)` → one TXD, each texture **2× box-downscaled** until
  ≤ `maxSize`, then **DXT-compressed** with a full mip chain (**DXT1** opaque / **DXT5** alpha, via
  `encodeDxtStruct`) — uncompressed A8R8G8B8 blows the IMG up ~4× (a full cell build's TXDs were ~324 MB raw vs
  ~61 MB DXT). The DFF keeps its original texture **names** + UVs (perfect tiling, no atlas) so it resolves every
  texture from this single dictionary. Names missing from the source are skipped.
- `./encode-col` — `encodeColLibrary(bounds, names)` → a **COL3 bounds-only** library: one 112-byte model per LOD
  (bounds set, zero spheres/boxes/faces/verts), like SA's LOD vegetation (`lodCedar1_hi`). SA binds collision by
  **model name**, so each LOD needs a named entry or the game faults ("model … does not have loaded collision").

### Sources (lazy, archive-backed)

- `./model-source` — `createModelSource(archives)` → `ModelSource.load(model)`: look up `<model>.dff` across the
  IMG archives, `parseDff` (read-only), memoize. Misses cache as null (logged once) — a model is instanced many
  times, so don't retry.
- `./texture-source` — `createTextureSource(archives)` → `TextureSource.get(name)`: index every TXD's
  `TEXTURE_NATIVE` by name on first use, decode the requested texture's top mip to RGBA (DXT via the map-optimizer
  decoder, or raw rgba8888), memoize. Missing/unparseable → null (the encoder falls back). First TXD wins on a
  name clash.

### Prelight transfer (`--prelight`)

- `./prelight` — stock→custom prelight transfer, shared by **both** LOD tools (`lod-trees-generator` and
  `lod-procobj-generator`). Custom HD models often ship with badly-set prelit (black / washed-out) versus the stock
  model SA lit for that spot, and SA draws `prelit × material` — so the swapped HD + its LOD look wrong in-world.
  We take one representative ambient colour from the **stock** model's prelit (`stockPrelightColor`, mean RGBA) and
  write it onto the **trunk** (opaque surfaces); **foliage** (alpha-cutout, `FoliagePredicate`) keeps its own.
  - `applyStockPrelight(customDff, stockDff, isFoliage)` — the **HD DFF** path (per-geometry Struct prelit fill +
    PRELIT flag); topology-independent (one representative colour, not a 1:1 copy). Used by both tools' HD swap.
  - `applyMeshTrunkPrelight(mesh, trunk, isFoliage)` — the decimated **LOD mesh** path (per-vertex recolour of
    `MergedMesh.colors`); `lod-procobj-generator`'s mesh LOD. (`lod-trees-generator`'s billboard LOD re-bakes the
    atlas instead, in its own `io.ts`.)
  - `parsePrelightInfo(text)` → `PrelightInfo { skip }` — the `--prelight <info.json>` per-model override
    (`{ "<model>": { "skip": true } }` opts a model out of the transfer entirely).

## SA-strict invariants (the encoders enforce)

These are why the output renders in-game and not just the viewer (full checklist: [[sa-generated-asset-format]]):

- DFF tristrip flag matches the data; no stale `rpEXTRAVERTCOLOUR`; BinMesh PLG present.
- TXD small enough to load (downscaled **and DXT-compressed** — DXT1/DXT5 + mips; raw A8R8G8B8 bloats the IMG ~4×).
- COL3 **112-byte** bounds-only models, named to the LOD's registered model.
- Object **id** assignment is **not** this package's job — that's `@opensa/map-placement`'s `allocateLodIds`
  (≤ 18630). `sa-lod` only encodes geometry/textures/collision.

## Tests

`encode-dff.test.ts`, `encode-txd.test.ts`, `encode-col.test.ts` — round-trip the encoded bytes back through the
engine parsers (`parseDff` / `parseTxd` / `parseColLibrary`) and assert structure (one atomic, material splits,
downscaled levels, 112-byte COL3). `prelight.test.ts` — the stock-ambient average, trunk/foliage split (HD
`trunkOnlyPrelit`/`applyStockPrelight` + LOD-mesh `applyMeshTrunkPrelight`), and `parsePrelightInfo` parsing.
`decimate` / `normals` are exercised via the consumers' pipelines and `tool-kit`'s own mesh tests.

## Consumers

`opensa-lod-generator` (per-cell) and `lod-procobj-generator` (per-species), paired with `@opensa/map-placement`
([001](../../../map-placement/docs/plans/001-architecture.md)) for the map-file side. `lod-trees-generator` also
imports `./encode-col` + `./prelight` (its impostor bake is otherwise its own).
