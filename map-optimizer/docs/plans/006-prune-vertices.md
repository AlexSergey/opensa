# 006 — Plugin: prune unused vertices

**Status: ✅ Implemented.** Drop vertices no triangle references, compacting every per-vertex attribute and
re-indexing the faces. A natural follow-on to [dedupe](./005-dedupe-faces.md) (which orphans vertices) and a
cheap size win. A vertex-count change → rides the count-changing re-encoder ([004](./004-topology-reencoder.md)).

## Context / problem

Removing faces ([dedupe](./005-dedupe-faces.md)) — and many exporter quirks — leave vertices that no triangle
uses. They bloat the Struct (positions/normals/UV/prelit/night arrays) and the VFS for nothing. Pruning them
is purely a size optimization with **no visual change** (unreferenced data can't be drawn).

## Decisions

- **Keep referenced vertices, in original order.** A vertex is kept iff some triangle references it; kept
  vertices preserve their relative order (deterministic, stable). All per-vertex channels (positions, normals,
  UVs, prelit, night) are compacted to the kept set; triangles are re-indexed. No-op when all are used.
- **Runs last** in the default pipeline (after `dedupe-faces`, which is what most often orphans vertices).
- **Shared compaction.** The "rebuild per-vertex arrays from a vertex remapping + re-index triangles" step is
  common to `weld-vertices`, so it's extracted to `remapVertices` and reused by both — one place, one test
  surface.

## Module changes

- **`plugins/vertex-compaction.ts`** (new): `remapVertices(mesh, oldToNew, sourceOf)` — rebuild a sub-mesh's
  per-vertex arrays (each new slot copied from `sourceOf[new]`) and re-index triangles via `oldToNew`.
- **`plugins/weld-vertices.ts`**: refactored to build the mapping and call `remapVertices` (drops its inline
  channel machinery).
- **`plugins/prune-vertices.ts`** (new): pure `pruneMesh(mesh)` + `createPruneVertices()`.
- **`optimizer.config.ts`**: default pipeline gains `prune-vertices` as the final stage.

## Scope

- **In:** prune unreferenced vertices; the shared `remapVertices`; weld reuses it; config wiring; unit tests
  (prune drops an unused vertex + re-indexes + keeps attributes aligned; no-op when all used; weld still
  passes via the shared helper).
- **Out (later):** removing degenerate (zero-area) triangles and the verts they orphan; T-junction welding;
  coplanar/decal dedupe.

## Risks / testing

- **Attribute alignment** is the crux — a unit test prunes a middle vertex and checks the surviving
  positions/normals line up with the re-indexed triangles.
- **Rebuild path:** a vertex-count drop (triangles unchanged) routes through `rebuildGeometry`; a real
  `--game gostown` run (weld → dedupe → prune) removes orphaned verts, every output re-parses, and triangle
  counts + material sets stay consistent. Guards (skin/multi-UV) still isolate per asset.
- **Weld regression:** weld’s behaviour is unchanged (same tests pass through the shared helper).
- Determinism: pure, stable order, no RNG.
