# Idea — Map optimizer (DFF conditioning pipeline)

**Status:** idea / not scheduled. Captured from a design discussion.

A "gulp-like" conveyor that runs every map DFF through composable geometry transforms to make the map clean
and consistent: aligned normals + smoothing, welded vertices, removed duplicate polygons, and conditioned
prelit / night-vertex colours.

## Why

- **Mod re-exports have unreliable normals** (flat / per-face / garbage). We already patch the worst with
  `sanitizeDegenerateNormals` (build side, plan 037), but it only replaces zero/NaN normals with face
  normals — it doesn't smooth.
- Under [plan 038](../plans/038-sa-prelit-lighting.md) the map is **unlit**, so today normals only feed SSAO
  — clean normals buy little **until** we add lighting to the map. This tool is therefore mainly an
  **enabler** for [map lighting](./vehicle-headlights.md) / a sun-on-buildings term: those need decent
  normals or they look faceted.
- Duplicate / coplanar polygons cause z-fighting; welding + dedupe also trim vertex counts (perf).
- Some objects have missing or inconsistent prelit (esp. LODs with no night-vertex set) → night looks
  uneven across LOD↔HD under the 038 blend.

## Key insight — lighting ⟂ asset format

Lighting is a render-time concern (`world-material` shader); it does **not** require a new asset format or a
DFF writer. The only thing it needs from geometry is **good normals**. So conditioning can be done
**in-memory** on the parsed `RWClump`, and we stay on the DFF path.

## Pipeline (pure `RWClump → RWClump` transforms)

Composable, each independently testable, configurable per stage:

1. **Weld vertices** by position (DFF splits verts at UV seams) — needed so smoothing can average across
   shared edges.
2. **Remove duplicate polygons** (exact dupes; optional coplanar). ⚠️ Some "dupes" are **intentional**:
   two-sided alpha and decal overlays — needs heuristics, not a blanket dedupe.
3. **Recompute normals** with an **angle-weighted average + crease angle** (hard edges above the angle,
   smooth below). This _is_ "smoothing groups" (DFF has per-vertex normals, not Max smoothing groups).
   - **Cheapest, safest variant:** compute via a _position-welded adjacency map_, then **overwrite only the
     normal attribute** on the original vertices → **no topology change**, no cascade, no writer needed.
4. **Condition prelit / night colours** — _not_ "make them identical" (that flattens Rockstar's baked AO and
   looks worse). Instead: **fill gaps** (generate a consistent day/night baseline + AO where missing,
   especially LOD night-vertex) and/or **normalize brightness** so the 038 blend is uniform.

## Output — three options

The transforms are the easy part; **where the result lives** is the real decision:

- **(A) In-memory at `getClump` (recommended).** Run the conditioning when the clump is parsed; `getClump`
  caches per model name → runs **once per unique model per session**. DFF stays the on-disk source. **No
  writer, no new format.** Normals-only recompute (step 3 variant) needs no topology bookkeeping at all.
  Cost: CPU per unique model (bounded, spread over streaming); cache if needed.
- **(B) Offline bake to our own format.** Persist conditioned geometry the loader reads directly (skip DFF
  parse + conditioning at runtime). Simpler/safer than a DFF writer; loses "real .img" portability and needs
  the viewers updated. Pick this if (A)'s runtime cost is too high.
- **(C) Re-emit real DFF (writer).** Keep the `.img` path. Needs a **DFF serializer we don't have**, must
  **passthrough all unparsed chunks raw** (2dfx, skin, breakable, env-map, uv-anim, hanim, right-to-render)
  and **regenerate BinMeshPLG + sizes** when topology changes. Heaviest + riskiest; only if we need a clean
  `.img` outside our pipeline.

## Caveats

- Any topology change (weld/dedupe) cascades: triangle material indices, BinMeshPLG, day+night prelit
  arrays, UV layers, skin (n/a for static map), bounding sphere. The **normals-only** path avoids all of it.
- Dedupe can delete intentional 2-sided/decal faces — needs care.
- Flattening prelit = worse, not better (loses baked AO/shadows).
- Validate on the "dirty" fixtures (`casroyale` zero-normals, `trafficlight`) + a full-map sweep before/after.

## When we pick this up

1. Decide the goal: pure cleanup (dedupe + prelit gap-fill) vs enabling map lighting (then normals/smoothing
   matter).
2. Decide output: start with **(A) in-memory, normals-only** — lowest risk, no format change; profile.
3. Pick params: crease angle, weld epsilon, prelit fill strategy.
4. Wire an A/B toggle (conditioned vs raw) for validation.

Related: [vehicle-headlights.md](./vehicle-headlights.md), [plan 038](../plans/038-sa-prelit-lighting.md),
[DFF parser](../features/dff-parser.md).
