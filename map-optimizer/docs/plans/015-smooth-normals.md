# 015 — Smooth-group normal rebuild

**Status: ✅ Implemented & verified in-game** (`plugins/smooth-normals.ts`, default pipeline — replaces
`recompute-normals`). Rebuilds world-model normals from **smooth groups** with hard-edge **vertex splitting**, so
the engine renders clean lighting/SSAO instead of the smeared gradients and double-face slivers it gets from
naive normal derivation. In-game check confirmed clean walls / sharp edges; kept map-wide for now, the **+40%**
build size accepted (scoping to skip crease-free terrain noted as a future option if size needs cutting).

## Context / problem

SA's world is **unlit**, so most map geometry ships with **broken or absent vertex normals**. The engine then
falls back to three.js `computeVertexNormals` (`build-clump.ts`) — a whole-mesh average with **no crease
awareness** — which:

- **smears flat walls into gradients** (a single normal per shared vertex must blend the faces around it),
- **cancels to zero at double faces** (coincident opposite-wound panels) → repaired into stray **slivers**,
- feeds **SSAO** garbage → **dark road edges**.

The reference is the MixMods _Proper Shaders_ tool, which "recalculates normals **and smooth groups** for the
whole map" and explicitly **fixed models with double faces** (where a naive recalc broke). Our previous
`recompute-normals` (one normal per vertex, no splitting) couldn't — it blends at every shared hard corner.

## Approach

1. **Weld** vertices by position; compute face normals + areas.
2. **Smooth groups:** union-find faces across edges whose dihedral ≤ crease angle (default 45°); hard edges,
   boundaries and double faces bound the groups.
3. **Split + average:** each vertex takes the area-weighted normal of **one** group; a vertex shared by several
   groups is **duplicated** into one copy per group (its own flat normal). UV/prelit/night are copied onto the
   splits, so seams are preserved. Positions/winding are unchanged → no cracks.

Vertex count grows at hard edges, so it rides the **count-changing serializer** (`rebuildGeometry`). Runs
**after** the geometry-cleaning passes (weld/degenerate/dedupe/prune) so it fits the final, clean mesh.

## Results (stock `original`)

| model                                   | verts       | face-deviation (mean / max)     | size |
| --------------------------------------- | ----------- | ------------------------------- | ---- |
| `santahouse02_law2` (double-face house) | 1177 → 1921 | 0.9° → **0.3°** / 90° → **35°** | +77% |
| `beach01_law2` (road)                   | 921 → 925   | 2.5° → **1.8°** / 91° → **17°** | +27% |

`0` zero-length normals on both (slivers gone); hard 90° corners split cleanly; double faces get opposite
normals. **Full build: +40%** (237 → 333 MB), **0 failures** — the cost of the normal block plus hard-edge
splits (buildings split heavily, smooth roads/terrain barely).

## Corruption bug found + fixed (serializer)

The first build **shattered** the map. Two compounding issues, both fixed:

1. **`smooth-normals` reordered the whole vertex array.** When a model needed no splits the vertex count was
   unchanged, so the serializer took its attribute-overlay path and kept the (now-stale) struct triangle
   indices → shatter. Fix: keep original vertices in place, only **append** split copies (no reorder), so a
   no-split model is byte-identical topology.
2. **`encodeDff` chose overlay-vs-rebuild by vertex/triangle _counts_.** weld/prune + smooth-normals together
   can change the topology while the counts land back on the source's, so the overlay path was wrongly taken.
   Fix: compare the **actual triangle indices** (`sameTopology`) — overlay only when they're identical,
   otherwise rebuild (which correctly refuses multi-UV/skin, keeping those models stock). Regression test added.

Full-build scan after the fix: **0 corrupted** of 14,865 models; the world set the CLI builds has **0
failures** (the ~613 refusals are vehicles/peds/interiors the CLI never processes).

## Trade-off / next

Quality matches the goal, but **+40% map-wide** is a lot. If size matters more than perfect normals everywhere,
scope it — e.g. skip crease-free smooth terrain (which the engine's naive average already handles fine), or only
split where double faces / sharp corners actually occur. Left map-wide for now; the real gate is an in-game look.
