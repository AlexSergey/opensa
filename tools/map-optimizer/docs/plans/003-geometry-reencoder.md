# 003 — Geometry Struct re-encoder (faithful decode/encode + add-normals)

**Status: ✅ Implemented.** A full **Geometry Struct (de)serializer** that rebuilds the Struct body from a
decoded model — replacing the in-place byte patcher from [001](./001-pipeline-architecture.md). This unlocks
**layout changes** the patcher couldn't express: chiefly **adding a normals attribute** to a normal-less map
model (so it can be lit), plus a clean foundation for count-changing topology later. Identity round-trip stays
the correctness gate.

## Context / problem

The in-place patcher ([001](./001-pipeline-architecture.md)) overwrites attribute bytes only — it can't grow
the Struct, so it can't **add** normals to a model that has none. Most GTA SA map geometry is prelit and
**ships no normals**, so [002](./002-recompute-normals.md) skipped those meshes — exactly the ones map lighting
needs. We need to re-emit a Struct whose layout differs from the source (a normals block appears, the NORMALS
flag flips), while preserving everything else byte-for-byte.

## Decisions

- **Full Struct codec.** `decodeGeometryStruct(bytes)` → a `GeometryStruct` (flags, counts, prelit, all UV
  layers, triangles, morph targets with positions/normals), and `encodeGeometryStruct(gs)` → bytes. Their
  **identity round-trip** (`encode(decode(b)) === b`) is the gate; floats/u16s reproduce exactly.
- **`encodeDff` routes every geometry through decode → overlay IR attributes → encode** (replaces the in-place
  patcher). Unchanged IR ⇒ identical bytes, so the codec subsumes the old fast path.
- **Overlay, don't rebuild.** Only the attributes the IR models are overlaid (morph-0 positions/normals,
  prelit, UV layer 0); **everything else is preserved from the decoded Struct** — extra UV layers, extra morph
  targets, triangles (kept as-decoded, so material-recovery in the IR never corrupts on-disk indices), bounds.
- **Add-normals supported.** If the IR has normals and the Struct didn't, the codec appends the normals block
  to morph 0 and sets the NORMALS flag. The Geometry chunk's size (and all parents') is recomputed by the
  chunk codec automatically.
- **Vertex count stays fixed (this plan).** All per-vertex siblings outside the Struct — skin, night colours,
  prelit — and `BinMeshPLG` remain valid only while the vertex/triangle counts don't change, so a **count
  change still throws** (`topology change unsupported`). Full weld/dedupe/hole-fill (BinMeshPLG regen +
  per-vertex remap of prelit/night/skin + bounding recompute) is the **next** plan, built on this codec.
- **`recompute-normals` gains `addMissing`** so it can populate normal-less meshes — the thing that exercises
  add-normals end to end.

## Module changes

- **`adapters/gta-sa/codec/geometry-struct.ts`** (rewritten): `GeometryStruct` type + `decodeGeometryStruct` /
  `encodeGeometryStruct` + `applyMeshToStruct(structBytes, mesh)` (decode → overlay → encode; throws on a
  vertex-count change).
- **`adapters/gta-sa/codec/dff.ts`**: `encodeDff` calls `applyMeshToStruct`; `collectGeometryStructs` exported
  for tests.
- **`plugins/recompute-normals.ts`**: `RecomputeNormalsOptions.addMissing` — compute + attach normals where a
  mesh has none.

## Scope

- **In:** the faithful Struct codec + identity round-trip; `applyMeshToStruct` (attribute overlay + add /
  replace normals, vertex count fixed); `encodeDff` rerouted through it; `recompute-normals` `addMissing`;
  tests (codec round-trip synthetic + real, add-normals, topology-count guard, encodeDff identity preserved).
- **Out (plan 004+):** vertex/triangle **count** changes — `BinMeshPLG` regeneration, per-vertex remap of
  prelit/night/skin, bounding-sphere recompute; weld / dedupe / hole-fill / remesh plugins; multi-morph
  animation; TXD work.

## Risks / testing

- **Codec fidelity is the gate:** `encodeGeometryStruct(decodeGeometryStruct(b))` is byte-exact (synthetic +
  a real fixture Struct), and `encodeDff` identity on the committed DFFs still holds (now via the codec).
- **Add-normals correctness:** a no-normals Struct + a mesh with normals → decode shows the normals block, the
  NORMALS flag set, the vertex count and positions unchanged, and the rest of the chunk preserved.
- **Boundary:** a vertex-count change throws (the BinMeshPLG/remap work isn't done yet) — isolated per asset.
- **Real data:** `--game ./game-src/gostown` with `recompute-normals({ addMissing: true })` adds normals to the
  normal-less map models and re-serializes them with no new serializer failures; default (no addMissing) still
  round-trips byte-identical.
