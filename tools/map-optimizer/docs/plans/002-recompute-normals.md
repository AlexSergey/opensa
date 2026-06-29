# 002 — Plugin: recompute normals (angle-weighted, crease-limited)

**Status: ✅ Implemented.** The first real transform on top of the [001](./001-pipeline-architecture.md) base:
recompute per-vertex normals so smooth surfaces read smooth and hard edges stay hard — fixing the flat /
per-face / garbage normals that mod re-exports ship. Topology-preserving (overwrites the normal attribute
only), so it rides the serializer's in-place patch path with no re-encoder.

## Context / problem

DFF exporters split vertices at UV seams (and at hard edges), and many leave normals flat or per-face. Under
map lighting / SSAO that looks faceted, and seam splits make a smooth wall show a visible crease where the UV
cut is. We want the standard "auto-smooth with a crease angle": average face normals across a vertex, but
treat edges sharper than a threshold as hard. The catch: we **cannot change topology** (the in-place patcher
keeps vertex/triangle counts), so we can't split or merge vertices — we can only rewrite the existing normal
array. The DFF's own seam/hard-edge splits + a crease test make that sufficient.

## Decisions

- **Position-welded, angle-weighted, crease-limited.** For each vertex `v`:
  1. Build a **reference direction** from the faces that use `v` directly (its own corners' face normals).
  2. Gather **every face touching `v`'s position** (welding the seam/hard-edge duplicates the exporter made).
  3. The new normal = the angle-weighted sum of those faces whose normal is within `creaseAngle` of the
     reference; renormalize.
  - Smooth region → all coincident faces pass the crease test → seams average away (the win). Hard edge → the
    other side's faces exceed the crease angle → excluded → each split vertex keeps its side's normal (hard
    edge preserved) — **smoothing groups without splitting.**
- **Exact-position weld.** Exporter-duplicated seam/edge vertices share _identical_ position floats, so an
  exact key welds them; a `weldEpsilon` / spatial weld is a future refinement, not needed for the seam case.
- **Angle weighting** (corner angle at the vertex) — robust to triangle-fan density, unlike face-count or
  area weighting.
- **Only meshes that already have a normal attribute.** Adding normals to a normal-less map model changes the
  struct layout (a topology-class edit) → needs the full re-encoder; **out of scope** here (those meshes are
  skipped). Many SA map buildings are prelit/normal-less, so this mainly conditions peds/vehicles/props now and
  becomes broadly useful once "add normals" lands.
- **Configurable factory.** `createRecomputeNormals({ creaseAngleDeg })` so the pipeline config tunes it
  (default 45°). The pure `recomputeNormals(positions, triangles, existing, opts)` is unit-tested in isolation.

## Module changes

- **`plugins/recompute-normals.ts`** (new): the pure `recomputeNormals(...)` + the `createRecomputeNormals(...)`
  plugin factory (iterates `asset.ir.meshes`, recomputes where `normals` exists, sets `asset.dirty`, logs).
- **`optimizer.config.ts`**: default pipeline runs `createRecomputeNormals()` (was the no-op `pass-through`,
  which stays exported for reference).
- Degenerate faces (zero-area) contribute nothing; a vertex with no usable faces keeps its existing normal.

## Scope

- **In:** recompute existing per-vertex normals with angle weighting + a crease angle; the pure function +
  factory plugin; wiring into the default config; unit tests (flat smooth, seam-weld smoothing, crease
  preserves a hard edge, degenerate-face fallback).
- **Out (later):** adding normals to normal-less meshes (needs the re-encoder); `weldEpsilon` / spatial
  welding for near-coincident verts; prelit/night-colour conditioning; weld/dedupe/hole-fill plugins.

## Risks / testing

- **Crease correctness** is the crux — guarded by a unit test: two faces at 90° sharing a split edge keep
  their own-side normals (not averaged to 45°); two coplanar faces with a duplicated seam edge converge to one
  smooth normal.
- **Idempotence/serialize path:** marking a mesh dirty routes it through `encodeDff`; a real `--game ./game-src/gostown`
  run recomputes the models that have normals and re-serializes them, with no new serializer failures
  (topology/anti-rip cases still throw and are isolated per asset).
- Determinism: pure function, fixed weighting, no RNG.
