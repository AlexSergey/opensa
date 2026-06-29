# 007 — Plugin: remove degenerate triangles

**Status: ✅ Implemented.** Drop zero-area faces — coincident/collinear vertices, or the equal-index triangles
that welding can create — which render nothing but still cost. A triangle-count change → rides the
count-changing re-encoder ([004](./004-topology-reencoder.md)); the trailing `prune-vertices` then reclaims any
vertices they orphaned.

## Context / problem

DFF exporters leave degenerate triangles (two coincident corners, or three collinear ones), and
[`weld-vertices`](./006-prune-vertices.md) can turn a triangle whose corners were distinct-but-coincident into
an **equal-index** triangle. None of them draw a pixel, but they bloat the index buffer, the BinMeshPLG, and
the streaming cost. Removing them is purely a clean-up — no visual change.

## Decisions

- **Area test, one criterion.** A triangle is degenerate when `|cross(B−A, C−A)| < epsilon`. This subsumes the
  equal-index case (a zero edge → zero cross) and the coincident/collinear case, so there's a single rule.
- **Conservative epsilon** (default `1e-6` on the cross magnitude ≈ area · 2). Catches truly-zero and
  float-coincident faces while leaving legitimately thin geometry (slivers) alone; tunable via the factory.
- **Triangle-count change, vertices untouched** → the [004](./004-topology-reencoder.md) rebuild (Struct +
  BinMeshPLG regen). Orphaned vertices are reclaimed by `prune-vertices` running afterwards.
- **Runs after `weld-vertices`** (to catch weld-induced equal-index degenerates), before `dedupe-faces` /
  `prune-vertices`.
- **Pure `removeDegenerateTriangles(positions, triangles, epsilon)`** unit-tested in isolation;
  `createRemoveDegenerateTriangles({ epsilon })` is the factory.

## Module changes

- **`plugins/degenerate-triangles.ts`** (new): pure `removeDegenerateTriangles(...)` +
  `createRemoveDegenerateTriangles(...)` (iterates `asset.ir.meshes`, replaces `triangles`, sets `dirty`, logs).
- **`optimizer.config.ts`**: default pipeline becomes `recompute-normals → weld-vertices →
remove-degenerate-triangles → dedupe-faces → prune-vertices`.

## Scope

- **In:** zero-area face removal (area-epsilon); pure function + factory + config wiring; unit tests
  (removes equal-index, removes coincident-position, keeps a normal face, keeps a thin valid face).
- **Out (later):** sliver collapse / edge-flip (aggressive remesh); T-junction welding; coplanar/decal dedupe.

## Risks / testing

- **Conservatism:** the small default epsilon means only invisible faces go — guarded by a test that a thin
  (but non-zero) triangle is kept.
- **Rebuild path:** a triangle-count drop with unchanged vertices routes through `rebuildGeometry`; a real
  `--game ./game-src/gostown` run removes degenerate faces, every output re-parses, and triangle counts stay consistent
  through the rebuild. Guards (skin/multi-UV) still isolate per asset.
- Determinism: pure, order-stable, no RNG.
