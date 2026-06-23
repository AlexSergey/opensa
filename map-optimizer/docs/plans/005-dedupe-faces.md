# 005 — Plugin: dedupe faces (exact duplicates only)

**Status: ✅ Implemented.** Remove **exact duplicate triangles** — same vertices, same winding, same material
— which only z-fight and waste draw calls. Built on the count-changing re-encoder
([004](./004-topology-reencoder.md)): vertices are untouched, the triangle count drops, BinMeshPLG is
regenerated. **Deliberately conservative** — intentional two-sided faces and decal overlays are preserved.

## Context / problem

Mod re-exports often stack a face on top of an identical one (z-fighting, doubled cost). But not every
overlap is a mistake: **two-sided alpha** is the same triangle with **reversed winding**, and **decals** are
separate (different) coplanar faces — both intentional. A blanket "remove coplanar/overlapping faces" would
delete those, so the safe first dedupe removes only **literal duplicates**.

## Decisions

- **Exact-duplicate key = cyclic-canonical winding + material.** Rotate `(a, b, c)` to start at the smallest
  index (preserving winding) and append the material; keep the first triangle per key, drop the rest.
  - **Cyclic rotations** of the same winding (`0,1,2` ≡ `1,2,0`) → same triangle, same facing → **deduped**.
  - **Reversed winding** (`0,1,2` vs `0,2,1`) → different key → **kept** (two-sided alpha).
  - **Same triple, different material** → different key → **kept**.
  - **Different vertices on the same plane** (decals/overlays) → different key → **kept**.
- **Vertices untouched.** Only triangles are removed, so the vertex count is unchanged and the triangle count
  drops → the [004](./004-topology-reencoder.md) rebuild path (Struct + **BinMeshPLG regen** + bounds). Unused
  vertices left behind are harmless; pruning them is a later refinement (it's another count change).
- **Runs after `weld-vertices`.** Welding merges identical vertices, which turns "near-duplicate" faces that
  referenced different-but-identical vertices into exact-index duplicates → dedupe then catches them.
- **Pure `dedupeFaces(triangles)`** unit-tested in isolation; `createDedupeFaces()` is the plugin factory.

## Module changes

- **`plugins/dedupe-faces.ts`** (new): pure `dedupeFaces(triangles)` + `createDedupeFaces()` (iterates
  `asset.ir.meshes`, replaces `triangles`, sets `asset.dirty`, logs).
- **`optimizer.config.ts`**: default pipeline becomes `recompute-normals` → `weld-vertices` → `dedupe-faces`.

## Scope

- **In:** exact-duplicate face removal (cyclic-canonical winding + material); the pure function + factory +
  config wiring; unit tests (removes exact dup incl. cyclic rotation; keeps reversed winding, keeps differing
  material).
- **Out (later):** coplanar / overlapping-decal dedupe (needs geometry heuristics — risky); unused-vertex
  pruning; merging T-junctions; remesh / hole-fill.

## Risks / testing

- **Conservatism is the point** — guarded by tests that a reversed-winding twin and a differing-material twin
  are **kept**, while an exact (and a cyclically-rotated) duplicate is removed.
- **Rebuild path:** a triangle-count change with unchanged vertices routes through `rebuildGeometry`; a real
  `--game gostown` run (after weld) removes duplicate faces, every output re-parses, and per-face material
  multisets are preserved (BinMeshPLG stays consistent). Guards (skin/multi-UV) still isolate per asset.
- Determinism: pure, order-stable (keeps the first occurrence), no RNG.
