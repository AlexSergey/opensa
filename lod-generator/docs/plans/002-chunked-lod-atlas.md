# 002 — Chunked LOD generation with texture atlases

**Status: 📝 Proposed (design).** Replace SA's per-instance LODs with **regenerated, grid-chunked** LODs baked
from the HD models: cut the world into equal square cells, and for each cell emit **one decimated merged mesh +
one atlas texture**. Strip the old LOD models, and emit fresh IPL placing the new cell-LODs. The modern
open-world LOD scheme (cf. GTA V SLOD). **The engine already renders this** (its streaming is a per-cell HD/LOD
grid), so this is **entirely a lod-generator task** — no `../src` render change, only a cell-size config match.

**Target: OpenSA + original GTA SA, one build (decided).** The whole bake (Phases 1–2) and the output assets
(standard RenderWare DFF/TXD + text IDE/IPL) are **engine-independent**, so a single build serves both — only
the **binding** differs and it's localized to Phase 3 (emit). See "Dual-target binding" below.

## Goal (from the request)

1. **Remove all old LODs** — SA's `lod*` DFFs + their IPL `lod` references.
2. **Regenerate new LODs** from the HD models (decimation, not hand-authoring).
3. **Emit IPL** that places the new LODs.
4. **Chunk the map into equal squares**, each with **one big atlas texture** per square.

## Why chunked-atlas (and not per-model decimation)

Per-model decimation (one LOD per HD model) is simpler but keeps hundreds of small LOD draws + their textures.
The chunked scheme bakes a whole cell into **one mesh + one texture** → far fewer draw calls and texture binds
at distance, a clean uniform LOD ring, and LOD shading that matches HD (re-derive normals via map-optimizer's
plan 015, sample prelit from HD). The right architecture for a streamed open world.

## The scheme

```
world → grid of N×N-unit cells   (= the engine's streaming cellSize)
  per cell:
    gather HD instances whose origin falls in the cell      (resolveCells — Phase 0, done)
    merge their world-space geometry, grouped by texture
    decimate the merged mesh (QEM) to a far-view budget
    pack the cell's textures into ONE atlas; remap UVs to atlas sub-rects
    re-derive smooth-group normals (map-optimizer plan 015); bake prelit from HD
    emit  lod_<cx>_<cy>.dff   +   lod_<cx>_<cy>.txd (atlas)
  emit IPL inst entries placing each cell-LOD
  strip old lod* models + old lod references
```

## Pipeline (phased to de-risk — the atlas is the hard part, so it comes last)

- **Phase 0 — measure / assemble. ✅ Done** (`adapters/gta-sa/resolve.ts` + CLI): bucket exterior HD instances
  into the grid; report cells / instances / unique models / max-per-cell. On `original` @ 256 m: **520 cells,
  30 981 HD instances, 5 958 models, ≤ 422 instances/cell** — the numbers to pick cell size + budgets from.
- **Phase 1 — geometry LOD, no atlas yet.** Per cell: merge + **QEM decimate** (Garland–Heckbert edge-collapse),
  keeping the **original textures / multi-material** (no atlas). Emit cell DFF + IPL. Validate it loads, places,
  and the engine renders it. Proves assembly + decimation + placement before the atlas.
  - **1a — merge. ✅ Done** (`adapters/gta-sa/{io,model-source,merge}.ts`): load HD DFFs from the archives
    (engine `parseDff`, cached), transform each instance into cell-centre-relative native Z-up world space (IPL
    quaternion **conjugated**, DFF frame ignored — as the engine does for map atomics), bucket triangles by
    texture into a `MergedMesh`. Densest cell (3,−7): 422 instances → 85 959 verts / 56 490 tris / 156 textures
    in 24 ms. Unit tests on synthetic clumps (transform, re-base, texture grouping).
  - **1b — normals. ✅ Done** (`adapters/gta-sa/normals.ts`): re-derive smooth-group normals on the merged cell
    mesh via the shared `tool-kit/mesh/smooth-normals` core (extracted from map-optimizer plan 015 — now used by
    both tools). Densest cell: 85 959 → 102 053 verts (+16 k splits at hard edges), **all unit-length**, tris
    unchanged. Runs post-decimate once that lands. (Shared `tool-kit` also now holds the editable **IMG** module
    — open/add-replace/delete/rebuild — used by map-optimizer + lod-generator emit. Monorepo-package move:
    `docs/ideas/monorepo-packages.md`.)
  - **1c — QEM decimate. ✅ Done** (`tool-kit/mesh/simplify.ts` + `adapters/gta-sa/decimate.ts`):
    Garland–Heckbert edge-collapse to `decimateTargetTriangles` (config, default 4000). Per-texture groups →
    face groups, so texture seams + the cell's open silhouette are pinned with a heavy boundary quadric;
    UV/colour ride along as interpolated attributes; placement = cheapest of {endpoints, midpoint}; foldover
    collapses rejected. Pipeline is now merge → decimate → normals. Densest cell: 56 490 → exactly 4 000 tris in
    ~560 ms, **Z-height 49.3 preserved** (silhouette intact), normals re-derived all unit-length. Generic core
    in tool-kit (single consumer for now; see monorepo idea). Unit tests on a flat grid (budget, in-bounds,
    indices valid).
  - **1d — emit.** Split:
    - **1d-i — DFF writer. ✅ Done** (`adapters/gta-sa/dff.ts`): build a standard SA clump from scratch
      (FrameList + GeometryList + Atomic + per-texture MaterialList + **BinMesh PLG** so the real game renders
      the splits) via the map-optimizer chunk codec + `encodeGeometryStruct`. Round-trips through the engine
      `parseDff`: real densest cell → 7771 verts / 4000 tris / 81 materials / prelit + UV + normals, 364 KB.
    - **1d-ii — finalize. ✅ Done** (`adapters/gta-sa/finalize.ts`, CLI `--build`): bake every cell → one
      `models/lods.img` (cell DFF + per-cell TXD each) via the tool-kit editable IMG, emit `data/lods.ide`
      (cell-LOD defs, `lodDrawDistance` 1500) + `data/lods.ipl` (inst at cell centre, lod = −1), register all
      three in `data/gta.dat` (decided), mirror the rest to `out/<game>/`. Cell-LOD ids start at **max IDE id +
      1** (decided). Dual-target: `lod`-prefix name (OpenSA bucket) + IDE/IPL + big drawDist (original +
      Project2DFX). Validated in-memory: built IMG round-trips — `lod_3_-7` → 4000 tris / 81 textures, **81/81
      covered by its cell TXD**. **Additive** — old `lod*` not yet stripped (coexist; see 1d-iii).
    - **1d-iii — strip old LODs** (follow-up): remove `lod*` models + their IPL `inst` entries, null dangling HD
      `lod` refs, so the new cell-LODs don't overlap the originals. Also: DXT-encode the cell TXD; verify the
      DFF/TXD size vs the stream-model limit in-game.
- **Phase 2 — per-cell TXD (revised from "atlas").** Probing showed **88 % of a cell's texture groups tile**
  (UV > 1.5 — roads/pavement/terrain), so a true UV-remap atlas would smear the bulk. **Decision: per-cell TXD,
  not an atlas** — one TXD per cell holding the cell's textures (downscaled to `lodTextureSize`, default 64),
  geometry stays **multi-material with original UVs** → tiling is perfect, no remap. A true single-texture atlas
  (1 draw/cell, needs baked tiling via render-to-texture) is a later optimisation.
  - **2a — texture source. ✅ Done** (`adapters/gta-sa/texture-source.ts`): index every TXD in the archives
    (engine `parseTxd`), decode a texture's top mip to RGBA (map-optimizer `decodeDxt` / raw), cached. Densest
    cell: 156/156 textures resolved in ~380 ms.
  - **2b — cell TXD writer. ✅ Done** (`adapters/gta-sa/cell-txd.ts`): downscale (2× box, map-optimizer mip lib)
    - `encodeRgba8888Struct` (uncompressed A8R8G8B8) → TEXTURE_NATIVE → TEXTURE_DICTIONARY via the chunk codec.
      Round-trips through the engine `parseTxd`; densest cell → 81/81 refs covered, 1.18 MB @ 64px. **Follow-up:**
      DXT-encode the cell TXD (~4–8× smaller) once functional.
- **Phase 3 — integrate + remove old.** Strip the SA `lod*` models + their IPL entries, emit the new cell-LOD
  instances, set the bake cell size = the engine `cellSize`. Emits the **dual-target** build below (no engine
  code — see "Engine fit").
- **Phase 4 (optional) — procedural clutter.** Distant trees/rocks impostors (see "Procedural clutter" below).

## Dual-target binding (OpenSA + original SA) — one build

The bake is identical; only how each renderer _binds_ the cell-LOD differs. We emit **one build that satisfies
both**, with **no edits to the HD instances** (independent-LOD binding — chosen for simplicity + a clean blast
radius; the alternative, rewriting each HD inst's IPL `lod` index to point at its cell-LOD, was rejected as
invasive):

- **Name** each cell-LOD `lod_<cx>_<cy>` → **OpenSA** auto-buckets it into `cell.lod` by the `lod`-prefix and
  streams it on the LOD ring (no IDE/IPL `lod`-index needed).
- **IDE def + IPL `inst`** with a **large draw distance** → **original SA** renders it as an independent distant
  object; its draw distance (not a per-instance link) governs visibility, and HD↔LOD overlap is handled by the
  engine's normal alpha-fade. The IPL `inst` `lod` column stays `-1` (HD instances untouched).

**Original-SA prerequisites (not our code, but required for it to look right there):**

- **Project2DFX** — effectively required: vanilla caps draw distance (~300 m), too short for a 256 m cell-LOD to
  read at distance; Project2DFX lifts the cap so the cell-LODs show.
- **A limit adjuster** (fastman92 / Open Limit Adjuster) — for object/model/stream limits. Net object count
  actually **drops** (we remove thousands of per-instance `lod*`, add ~520 cell-LODs), but stay safe.
- **Stream model size** — one merged cell DFF must fit the streaming size limit; the decimation budget controls
  this (Phase 1 measures it).

## Engine fit — already chunked, no render-engine change needed

OpenSA's engine reimplemented LOD as a **cell grid**, which fits chunked-atlas LODs natively:

- `renderware/map/world-grid.ts` — `buildWorldGrid(defs, cellSize)` buckets the map into **square cells**,
  splitting each into **HD vs LOD** by `isLodModel` (the `lod`-prefix).
- `streaming.system.ts` — requests each cell at **HD _or_ LOD** detail by distance ring (`streamKey(cx, cy,
lod)`); never both → **no double-draw**, **no per-instance suppression** needed (the ring already does it).
- `build-cell.ts` — builds a cell's meshes from its HD or LOD instance list.

A generated `lod_<cx>_<cy>` model (lod-prefixed) is auto-bucketed into `cell.lod` and rendered as-is. **No
`../src` change** — only **config**: the bake cell size must equal the streaming `cellSize` (one baked LOD = one
engine cell), plus the LOD-ring distance (also config).

## Procedural clutter (procobj / trees / rocks)

Two distinct kinds, handled differently:

- **IPL-placed trees/rocks/objects** → **already included.** They're ordinary HD instances, so the per-cell merge
  bakes them like any other model. No special handling.
- **Procobj-scattered clutter** (`procobj.dat`, runtime-scattered by surface material — `grass / flowers /
bushes / cacti / rocks / trees / underwater`) → **not in IPL**, so not in the bake by default:
  - **Small clutter** (grass/flowers/bushes/cacti, draw dist 50–100 m) → **skip.** Invisible at LOD distance and
    runtime-scattered; baking it is pointless.
  - **Procobj trees (≈150 m) and rocks** → worth baking as **distant impostors** (Phase 4) to kill far-forest
    **pop-in**. Requires replicating the engine's **deterministic** procobj scatter offline (reuse
    `procobj-runtime`/`procobj-scatter` read-only so the baked far forest matches the near one), then adding
    **tree billboards** / low-poly rocks into the cell mesh + atlas. Real but standard; kept optional.

## Reuse vs. new

- **Reuse (engine `../src`, read-only):** IDE/IPL parsers + world transforms (already in `resolveCells`); the
  engine's cell grid + HD/LOD streaming (renders the cell-LODs as-is); for Phase 4, the procobj scatter.
- **Reuse (sibling `../map-optimizer`):** the **DXT encoder + VER2 archive writer** (its plans 010/011) for the
  atlas TXD + packing; **smooth-group normals** (its plan 015) for the decimated cells; the DFF serializer.
- **New (in lod-generator):** **QEM decimator** (attribute-aware — preserve material/UV-seam boundaries, weight
  silhouette/border edges so the far contour survives); **rectangle-pack atlas builder** + UV remap; **prelit
  re-bake** onto the decimated mesh (barycentric sample from HD); an **IPL writer** (text `inst` — trivial); the
  **bake driver** + `finalize` (currently stubbed in the gta-sa adapter).

## Hard problems / risks

- **Atlas + tiled textures (dominant risk).** Terrain/road textures tile (UV > 1). Atlas packing breaks tiling.
  Options: (a) **bake** the tiled result to a unique texture (flattens tiling, costs memory); (b)
  **render-to-texture the cell** from the LOD view (closest to AAA distant LOD); (c) accept a non-tiled crop
  (fine at distance). Likely a mix: bake tiled ground, atlas the rest.
- **Cell-size alignment** — bake cell size must equal the engine `cellSize`, else a LOD spans cells and loads
  partially. Config, not code.
- **World assembly** — global IPL→world (done in Phase 0, read-only).
- **Decimation across merged materials** — QEM must treat material/atlas-region + open borders as constraints,
  else it holes/smears the silhouette.
- **Cell seams** — adjacent cell-LODs may gap/overlap at borders; snap shared border verts or overlap slightly.
- **Memory** — one atlas per cell × many cells. Budget atlas size (512²/1024²) + cell size together (Phase 0
  numbers).
- **Placement is NOT affected** (unlike a terrain remaster): LODs are display-only — no object/path/spawn
  re-authoring, no collision. This is why LOD generation is tractable.
- **Verification** — in-game only: HD↔LOD popping, atlas seams, tiling artifacts, cell gaps, forest pop-in.

## Scope

- **In:** assemble HD → cells (done); per-cell merge + QEM decimate; texture atlas + UV remap; prelit re-bake +
  smooth-group normals; emit cell DFF/TXD + **IDE + IPL** for the **dual-target** build (OpenSA `lod`-prefix +
  original-SA independent high-draw-distance objects, HD instances untouched); strip old LODs; align cell size;
  (optional) procobj tree/rock impostors.
- **Out:** per-instance (1:1) LODs; single-quad **building billboards** (a separate render-to-texture technique);
  collision (LODs have none); HD geometry changes (map-optimizer's domain); small procobj clutter.

## Relationship to other plans

- **lod-generator 001** — the architecture this implements (`LodAdapter.bakeCell` / `finalize`).
- **map-optimizer 015 / 010 / 011** — reused for normals + the atlas TXD / archive writers.
- **map-optimizer 014** (terrain smoothing — shelved): independent. Chunked LODs _reduce_ detail and so sidestep
  every reason 014 failed (no curvature recovery, no relaxation, no substrate move).
