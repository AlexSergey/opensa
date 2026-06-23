# 004 — Count-changing re-encoder (topology) + weld-vertices

**Status: ✅ Implemented.** Extend the re-encoder ([003](./003-geometry-reencoder.md)) to handle a **changed
vertex/triangle count**, so topology plugins (weld → later dedupe / hole-fill) can actually emit their result.
A count change means rebuilding the whole Geometry: the Struct from the IR, **BinMeshPLG** regenerated,
per-vertex **night colours** remapped, and the **bounding sphere** recomputed. The first such plugin is
**`weld-vertices`** (merge fully-identical vertices) — a conservative, no-visual-change demonstrator.

## Context / problem

[003](./003-geometry-reencoder.md) rebuilds the Struct but **throws on a vertex-count change**, because the
per-vertex data outside the Struct goes stale: `BinMeshPLG` (the material-split index buffers the engine draws
and recovers per-face materials from) and the `NIGHT_VERTEX_COLORS` extension. Welding/dedup/hole-fill all
change counts, so they're blocked. This plan rebuilds those siblings consistently from the IR.

## Decisions

- **Two paths in `encodeDff`.** When a sub-mesh's vertex **and** triangle counts match the source Struct →
  the faithful overlay path ([003](./003-geometry-reencoder.md), preserves multi-UV/skin/etc.). When either
  count changed → **`rebuildGeometry`** (full rebuild). So multi-UV/skinned models keep the safe path for
  attribute edits and only hit the guards if a plugin actually changes their counts.
- **Rebuild from the IR.** New Struct: flags (NORMALS/PRELIT set to match the IR), `numVertices`/`numTriangles`
  from the IR, positions/normals/UV-0/prelit from the IR, triangles re-indexed by the plugin, a single morph
  with a **recomputed bounding sphere**.
- **BinMeshPLG regenerated** as a **trilist** (`flags = 0`), grouping the IR triangles by material in
  ascending-material order, winding `(a, b, c)` to match the Struct — the chunk's version preserved.
- **Night colours remapped** — the `NIGHT_VERTEX_COLORS` chunk's body rebuilt (`flag=1` + RGBA×V) from the
  IR's compacted `nightColors`.
- **Guards (throw, isolated per asset)** on data the IR can't faithfully carry through a remap: **skin**
  (`0x116`), **>1 UV layer**, **≠1 morph target**. Map models have none of these; characters do (and aren't
  map targets) — so a `weld` on a skinned model throws cleanly.
- **`weld-vertices`** merges vertices identical in **all** attributes (position+normal+uv+prelit+night) → no
  visual change, just fewer redundant verts; re-indexes triangles; a no-op when nothing merges.
- **Chunk codec descends `EXTENSION`** (geometry-level) so BinMeshPLG / night chunks can be replaced; identity
  is preserved (an Extension body is exactly its plugin chunks).

## Module changes

- **`codec/chunk.ts`**: add `EXTENSION` to the container set; export `RW_EXTENSION` / `RW_BIN_MESH_PLG` /
  `RW_NIGHT_VERTEX_COLORS` / `RW_SKIN`.
- **`codec/geometry-rebuild.ts`** (new): `rebuildGeometry(geometryChunk, mesh)` — guards + Struct rebuild +
  BinMeshPLG regen + night remap + bounds; plus the BinMesh/night body builders + bounding-sphere helper.
- **`codec/dff.ts`**: collect Geometry chunks; route count-change → `rebuildGeometry`, else the overlay path.
- **`plugins/weld-vertices.ts`** (new): merge fully-identical vertices.

## Scope

- **In:** the count-changing rebuild (Struct + BinMeshPLG + night + bounds) with guards; `EXTENSION` descent;
  the `weld-vertices` plugin; tests (BinMesh build, rebuild semantic round-trip via weld + re-parse, weld
  reduces identical verts, guard throws on skin/multi-UV, real gostown weld run).
- **Out (later):** dedupe (remove duplicate/coplanar faces) and hole-fill / remesh plugins (they build on this
  rebuild path); skinned / multi-UV topology remap; per-cell map-wide stats; TXD work.

## Risks / testing

- **Correctness gate is our parser round-trip:** `rebuildGeometry` output re-parses (`parseDff`) to the
  expected geometry, and **per-face material recovery from the regenerated BinMeshPLG matches** the original
  (proves the split is consistent). In-game rendering isn't auto-verifiable here — weld is chosen precisely
  because it's semantically identical (same faces), so a BinMesh bug can't change appearance, only batching.
- **No-op safety:** weld with no duplicates leaves counts unchanged → the faithful overlay path → byte-identity
  preserved (regression-guarded).
- **Guards** keep us from silently corrupting skin/multi-UV models (unit-tested throw).
- **Real data:** `--game gostown` with weld removes redundant verts across the map models, every output
  re-parses, and material splits stay intact; no new serializer failures.
