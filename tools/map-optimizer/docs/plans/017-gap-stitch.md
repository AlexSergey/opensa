# 017 — Gap-stitch (close hairline cracks between adjacent objects)

**Status: ✅ Variants A + B + D implemented (opt-in `--stitch-gaps`) — pending in-game visual verification; C
deferred.** Everything lives in `adapters/gta-sa/gap-stitch.ts` (+ `boundary.ts` shared with plan 016), the
adapter's `buildGapStitches`, and three apply plugins run **first** (split → move → skirt):
`plugins/stitch-gap-split.ts` (B), `stitch-gap-position.ts` (A), `skirt-boundary.ts` (D) — B and D both ride the
count-changing `rebuildGeometry` path (no codec work). Things learned in build, folded in:

1. **A pairs by mutual-nearest**, not union→centroid (which collapses a seam — Approach step 2).
2. **B only reaches gaps within `maxGap`.** A diagnosed real crack (`vegassroad0522a` ↔ `vgssspagjun08`, a ramp
   meeting a slab) is a **wide** gap (boundaries meet at a few points then diverge **2+ units**) — beyond A **and**
   B. Confirmed **the dropped-filler theory was false** (same 6 models, byte-identical geometry, in mod + stock →
   the hole is stock SA content). So that class is **D's** job.
3. **D generalised to unique models too** (not only instanced): it skirts any **wide-gap horizontal** boundary edge
   A/B can't close. **Safe thresholds** (the "no big skirts where not needed" requirement): only near-horizontal
   surfaces (normal·up ≥ cos 40°), only a coplanar neighbour on the edge's **outward** side (via the owning
   triangle's apex — not the far edge / a side tile), at **similar height** (|Δz| ≤ `skirtMaxRise`), within
   `skirtMaxGap`; bounded `skirtDepth`; `skirtDepth 0` disables. Double-sided quad so it occludes from either side.

A new **opt-in** world-context pass (`--stitch-gaps`) that closes the thin
**visible crack** between two neighbouring map objects whose boundary edges run alongside each other but **don't
share vertices** (e.g. the LS storm-drain concrete meeting the sand slope). It **moves** near-coincident boundary
vertices of **uniquely-placed** models to a common point so the seam closes. The geometric sibling of the seam
weld (plan 016): that pass reconciles prelit **colour** at _already_-coincident vertices; this one makes the two
boundaries actually meet. **Scope = A + B + D** — stitch what can be edited, hide the rest:

- **A — vertex weld/move:** a boundary vertex of A near a boundary vertex of B → move both to a shared point.
- **B — T-junction edge split (mesh complexification):** a boundary vertex of A landing on the _interior_ of a
  boundary edge of B → **split** that edge, inserting a vertex on B at the projection so the two surfaces share
  the point. Run **bidirectionally** (split A for B's vertices too), then weld — so both boundaries end on the
  **same vertex set** and coincide.
- **D — boundary skirt:** where A/B can't run (a gap between two **instanced** objects — editing a shared DFF
  would change every placement), **extrude the gap-adjacent boundary edge into a thin downward skirt** so the void
  behind the crack is occluded. Doesn't close the seam; hides what you'd see through it.

A + B **conform** cross-object seams on uniquely-placed objects; **D** covers the instanced majority the coverage
census below shows A/B can't reach. **C** (true bridge geometry for wide/curved gaps with no vertex
correspondence) stays deferred. Reuses plan 016's whole Phase-1 world pre-pass.

## Context / problem

Adjacent SA objects are authored independently and frequently **don't share edge vertices** — one object's
boundary edge sits a fraction of a unit from the neighbour's, leaving a **hairline crack** you can see the void /
skybox through (screenshot: the storm-drain floor ↔ terrain slope). map-optimizer is **lossless today** (it never
moves a vertex), so it does **not** create these — they're stock/authoring gaps (or introduced by decimation
elsewhere). Nothing in the tool closes them: `README` and plans 001/002/005/006 list **"T-junction welding /
hole-fill / remesh"** as deferred backlog, never built.

Distinct from what exists:

- **`weld-seam-prelit` (plan 016)** — colour only, at **exactly**-coincident vertices; explicitly leaves geometry
  and T-junctions alone.
- **`refine-surface` (plan 014)** — smooths **within** a mesh, not the boundary between objects.

**Not a collision fix.** map-optimizer edits **render DFF** only, never `.col`. A crack you can _fall through_
(the vehicle drops into the void) is a **collision** gap and is out of scope here — gap-stitch closes the
**visual** seam. Flag this in the docs so the pass isn't mistaken for a physics fix.

## Approach — one world pre-pass, three appliers (reuses plan 016)

The **shared Phase-1 pre-pass** finds the cracks and **routes** each: a gap with a **uniquely-placed** side → A/B
stitch (edit that side); a gap between **two instanced** objects → D skirt (occlude). A/B and D then apply per
model. Phase 1 reuses verbatim: `resolvePlacements`, boundary detection, the conjugated-quaternion
`transformToWorld`, per-vertex world normals, and the spatial-hash grouping. The **only** additions:

1. **Tolerance band, not a point.** Two boundary vertices of **different** objects are a candidate when their
   world distance is in `(minGap, maxGap]` — **bigger** than the seam-weld coincidence (`≤ minGap` → plan 016's
   job) and **smaller** than `maxGap` (beyond that they're separate surfaces, not a crack). Default `(0.05, 0.4]`.
2. **Pair + route.** For A, pair each boundary vertex with the **mutual nearest-neighbour** other-model vertex in
   the band (closest, and closest back). **Not** union-into-a-group as first sketched — union across a band would
   chain an _entire_ seam edge (verts spaced < `maxGap` along it) into one component and **collapse it to a
   point**; a mutual pair moves each vertex at most half the gap and can't collapse a seam. If a pair's models are
   uniquely-placed → **stitch** (A/B). If both instanced → **skirt** (D): mark the instanced boundary edge.
3. **Emit** per-model, keyed by **local position**: A **position overrides** (`{localPos, newLocalPos}`, the pair
   **midpoint** back in local space via the inverse placement `worldToLocal`), B **edge-splits**, D **skirt edges**.

### A — apply the move (`plugins/stitch-gap-position.ts`)

For the current model, match vertices by **local position** and **overwrite the position** (xyz) to the stitched
target; **all other attributes (UV / prelit / normal / colour) stay** — a sub-`maxGap` move leaves UVs
imperceptibly stretched. Runs **early** (before `weld-vertices`) so every downstream pass (weld / smooth-normals /
seam-weld) sees the stitched geometry.

## Variant B — the conforming edge split (mesh complexification)

A (above) only closes a crack where A's boundary vertex is near **a vertex** of B. The common SA case is a
**T-junction**: independently-tessellated objects, so A's boundary vertex lands on the **interior of B's boundary
edge**, with no vertex to weld to. B inserts one.

**Phase 1 (extended).** For each boundary vertex `V` of model A **not** matched by variant A, test it against the
nearby boundary **edges** of the _other_ uniquely-placed models: project `V` onto edge `E = (p, q)` of B; it's a
split candidate when the projection is **strictly interior** (`0 < t < 1`, and not within `minGap` of `p`/`q` —
that's an A weld), the perpendicular distance is in the band `(minGap, maxGap]`, and the normal guard holds.
Record a split on B: `Map<modelName, { edge: [localPos_p, localPos_q], t, target }[]>`, where `target` is the
shared world point (`V`↔split-point centroid) in B's local space. **Bidirectional** — A's edges are split for B's
unmatched vertices the same way, so after the pass both boundaries carry the union vertex set.

**Phase 2 (extended, `plugins/stitch-gap-split.ts`).** Insert each split: a boundary edge belongs to **exactly
one triangle** (it's open), so splitting `E` at `t` replaces that one triangle `T = (p, q, w)` with `(p, r, w)` +
`(r, q, w)`, where `r` is a **new vertex** whose every attribute (position, UV, prelit, night, normal) is the
**linear interpolation** of `p` and `q` at `t` — exact, no material/UV guessing (the win over variant C). Several
splits on one edge → insert all, sort by `t`, fan-triangulate. `r`'s position is then set to `target` (the same
weld target A uses) so the surfaces meet. `T`'s **material index is preserved** on both halves.

This **changes vertex + triangle counts**, so B rides the count-changing `rebuildGeometry` path — which already
regenerates `BinMeshPLG`, remaps night colours, recomputes bounds, and (after this repo's multi-UV fix) carries
extra UV layers; skinned geometry is refused, but map models never are. So the serializer already supports the
complexification — no new codec work.

Keying: a split is keyed by its **edge** (`p`,`q` local positions) + `t`, resolved against the model's current
geometry in the apply. B runs **before** A's move and before `weld-vertices` (indices/positions still original).

## Variant D — boundary skirts (the instanced path)

A/B can only edit **uniquely-placed** models. The census shows the majority of coplanar cracks are between **two
instanced** objects (tiled roads / pavement), where editing a shared DFF to conform at one placement would corrupt
every other. D takes a different tack: don't close the seam, **occlude the void behind it**.

**What.** For a boundary edge that the pre-pass flags **gap-adjacent** (a coplanar neighbour surface within the
band but not coincident) and whose surface is roughly **horizontal** (normal ≈ up), **extrude it into a thin
skirt** — add two verts `p' = p − skirtDepth·n̂`, `q' = q − skirtDepth·n̂` (down the surface's own normal, so it
works at every rotated placement) and two triangles forming a quad hanging below the edge. Looking through the
crack you now see the skirt (textured like the surface) instead of skybox / void.

**Why it beats bridging (C) here.** The skirt is **model-local** — no cross-object correspondence, no world-space
new geometry to texture. Its verts inherit `p`/`q`'s **UV + prelit + material** (a vertical continuation of the
edge texture), so it reads as "the surface drops down a bit", never a foreign strip. And being model-local it's
valid at **every** placement → it works on **instanced** models, which A/B/C cannot.

**Instanced caveat.** A shared DFF's edge is skirted **or not** for all its placements — so D skirts an edge that
is gap-adjacent at **any** placement (union over placements), over-skirting the placements where that edge tiles
cleanly. The **horizontal-surface + gap-adjacent** gate keeps this off rooftop/ledge edges (no coplanar neighbour
below → not flagged), which is the failure mode of a blind skirt.

**Cost / limits.** +2 triangles per skirted edge (rides the same `rebuildGeometry` path as B — no codec work);
map-wide that adds up (report the count). The skirt is **visible from directly below / steep side angles** (it has
a bottom edge); `skirtDepth` trades occlusion vs how far it hangs. Doesn't fix collision.

## Correctness points

1. **Position key, not index** (same as plan 016) — the move is keyed by the _original_ local position; the apply
   runs before any re-indexing pass, so the key is unambiguous.
2. **Inverse transform.** The target centroid is in world space; write-back needs it in each model's local space:
   `localTarget = conjugate(rotation)⁻¹ · (centroid − position)` = `rotation · (centroid − position)` (undo the
   plan-016 conjugate). Unit-test this against `transformToWorld` (round-trip identity).
3. **Bounds recompute.** Moving a boundary vertex can push it outside the stored bounding sphere → culling fl. The
   count-changing `rebuildGeometry` recomputes bounds, and the default pipeline's `smooth-normals` triggers it; if
   gap-stitch runs **without** a topology pass, force a bounds recompute (small helper, or route through rebuild).
4. **Ordering.** Apply **first** (before `weld-vertices`). If combined with the seam weld: plan 016's pre-pass
   keys by position too, so it must be computed on the **already-stitched** geometry (gap-stitch feeds seam-weld),
   or the two are run in separate invocations. v1: ship them independent; document the "both at once" ordering as
   a follow-up (don't silently run both against raw positions).

## Tuning knobs

- `minGap` / `maxGap` (world units) — the crack band. Too wide → welds genuinely separate surfaces (a step, a
  lip, a doorway); too narrow → misses the crack. Conservative default, tuned in the viewer.
- **Normal guard** (reuse plan 016) — only stitch vertices whose world normals agree (`dot ≥ cos θ`), so a floor
  edge doesn't get pulled to a perpendicular wall base that merely passes nearby.
- **Move strategy** — default **centroid** (symmetric, both objects move ≤ half the gap). Option: **snap** the
  secondary object's boundary onto a designated primary (needs a priority rule; skip for v1).
- `maxMove` clamp — never move a vertex more than this, a backstop against a mis-grouped far target.

## Guards / conservatism

- **A/B edit uniquely-placed models only** (instancing constraint from plan 016 — editing a shared DFF changes
  every placement). **D (skirt)** is the instanced path and is local per-model, so it _does_ run on instanced
  models — but only on **gap-adjacent, roughly-horizontal** boundary edges (keeps it off ledges/rooftops).
- **Boundary edges only**, **band-limited**, **normal-guarded** → object interiors are never touched beyond the
  immediate boundary ring.
- **Opt-in `--stitch-gaps`**, off by default; every variant **changes geometry**, so (unlike the lossless core) it
  needs in-viewer sign-off before shipping.

## Coverage estimate (measured, stock `non-modified`)

A full-map census (throwaway; `resolvePlacements` + boundary verts of **all 45 531 instances** → **11.9 M** world
boundary vertices, spatial-hashed, **normal-guarded** so only near-**coplanar** near-misses count — the
see-through-crack proxy). A near-miss is **closable by A/B** when **≥ 1 side is uniquely-placed** (edit _that_ side
to conform to the neighbour — the neighbour is never touched); it's **unclosable by A/B** only when **both** sides
are instanced (a shared DFF can't be edited per-placement). Per boundary-vertex near-miss:

| `maxGap` | already coincident (plan 016) | gap near-misses | **A/B-closable (≥1 unique)** | both-instanced (→ D skirt) |
| -------- | ----------------------------- | --------------- | ---------------------------- | -------------------------- |
| 0.10     | 780 173                       | 183 862         | **45 668 (24.8 %)**          | 138 194                    |
| **0.25** | 780 173                       | 759 224         | **286 515 (37.7 %)**         | 472 709                    |
| 0.50     | 780 173                       | 1 329 704       | **604 188 (45.4 %)**         | 725 516                    |

**Reading it (caveats matter):** these are geometric near-miss **vertex-events**, an **upper bound** on visible
cracks (many coplanar near-misses read fine) and **per-vertex** (one crack = many verts) — so the **ratio**, not
the absolute, is the signal, and it's vertex-vertex (pure long-edge T-junctions add a little on top with the same
unique/instanced split). Takeaways:

- **A + B reaches ~25–45 %** of coplanar gap-events (the ≥1-unique ones) — and these are the **large uniquely-placed
  terrain / road / canal tiles**, i.e. the prominent see-through cracks like the screenshot. High value.
- **~55–75 % are between two instanced objects** (tiled roads / pavement, repeated props) — structurally out of
  reach for A/B. **That's what D (skirt) is for.** (Many instanced tiles also just tile cleanly → they're in the
  780 k _coincident_ bucket, not gaps.)
- Still nobody's job: **curved/differently-tessellated** seams (A/B leaves a residual chord gap → C), **holes inside
  one mesh**, and **collision** (`.col` untouched).

## Edge cases / limitations

- **Edge-to-edge gaps** (parallel boundaries with no vertex correspondence, wide or curved) still need **bridge
  geometry** — variant C, deferred (the true "hole-fill / remesh" backlog). T-junctions are handled by B; the
  instanced majority by D (skirt).
- **Opening a new gap.** Moving vertex V (A↔B) can widen A's seam with a _third_ object C on V's other side. The
  move is `< maxGap` so any new crack is sub-`maxGap`; a three-way group (A,B,C) resolves to one centroid and
  avoids it. Note as a residual.
- **Intentional gaps** (expansion joints, recessed panels, stylised steps) within the band would be wrongly
  welded — the normal guard + a tight `maxGap` mitigate; the opt-in + visual pass is the real safety net.
- **Collision unchanged** (`.col` untouched) — visual only.
- **Local distortion.** A boundary vertex also anchors interior triangles, so the move tugs the object's geometry
  a hair inward near the seam — negligible at sub-`maxGap` moves.

## Integration points

- `cli.ts` — add `--stitch-gaps` (mirrors `--weld-seams`).
- `adapters/gta-sa/seam-weld.ts` (or a sibling `gap-stitch.ts`) — extend the pre-pass: band grouping + centroid +
  inverse-transform → position overrides. Reuse boundary/transform/grid helpers (factor the shared bits out if
  needed).
- `adapters/gta-sa/index.ts` — a `buildGapStitches(options)` adapter method beside `buildSeamOverrides`, returning
  the A moves, the B edge-splits, **and** the D skirt marks (per gap the pre-pass routes to stitch when a unique
  side exists, else to a skirt on the instanced edge).
- `plugins/stitch-gap-split.ts` (B) → `plugins/stitch-gap-position.ts` (A) → `plugins/skirt-boundary.ts` (D) —
  inserted **first** in `optimizer.config.ts` when the flag is set: B grows the mesh, A snaps it, D adds skirts.
  D also rides the count-changing `rebuildGeometry` path (+2 tris/edge).

## Engine stays untouched

Same discipline as plan 016: engine (`packages/**`, `@opensa/*`) is **read-only reuse** (IPL parsing, DFF codec,
the conjugated-quaternion convention). **No change to `packages/`.** All new code under `tools/map-optimizer/`.

## Testing

**Synthetic unit tests** (no fixtures):

- two quads with a `0.2`-unit gap along one edge → boundary vertices move to the midline, the crack closes;
  interior vertices and UVs unchanged.
- a gap **wider than `maxGap`** → **not** stitched.
- a gap **smaller than `minGap`** (already coincident) → left to the seam weld, not moved.
- normal guard: a floor edge near a perpendicular wall base → **not** stitched.
- inverse-transform round-trip: `worldTarget → localTarget → transformToWorld` returns `worldTarget` (rotated
  placement).
- a model placed **twice** is skipped (instancing guard).
- **B — edge split:** a vertex projecting to the interior of a boundary edge splits the edge's one triangle into
  two, the inserted vertex's UV/prelit are the exact edge lerp, and the material index is preserved; the split
  vertex then coincides with the partner (crack closed). A projection **near an endpoint** takes the A weld, **not**
  a split. A projection **off the segment** (`t∉(0,1)`) does nothing.
- **B round-trips the serializer:** a split model re-parses (`parseDff(encodeDff(...))`) with the new vertex/
  triangle counts, a valid `BinMeshPLG`, and recomputed bounds.
- **D — skirt:** a gap-adjacent horizontal boundary edge gains 2 verts + 2 triangles extruded `−skirtDepth·n̂`,
  the skirt verts inherit the edge's UV/prelit/material, and the model round-trips. A **non-horizontal** or
  **non-gap-adjacent** edge (e.g. a rooftop ledge with no neighbour below) is **not** skirted.

**Real-asset integration test** (implemented, `gap-stitch.integration.test.ts`) via the existing fixture mechanism
(`npm run test:fixtures`, MANIFEST in `scripts/test-fixtures.ts` — build tooling, not the engine, as in plan 016):
the diagnosed **`vegassroad0522a` ↔ `vgssspagjun08`** ramp/slab pair (`tests/original/world/`) at their stock
placements — asserts variant A welds the points where they meet (each move a sub-unit nudge) and a 500-unit-apart
control stitches nothing. Full unit coverage: `gap-stitch.test.ts` (A weld / B split / D skirt + every guard),
`boundary.test.ts` (inverse-transform round-trip, edge/vertex/apex), and the three apply plugins'
`*.test.ts` (position move, edge split + fan, skirt quad + attribute copy).

## Performance / memory

The Phase-1 pre-pass holds **every boundary vertex + edge of every uniquely-placed model** (world coords + normals,
as objects) — on a full SA map that's ~6 GB transient. Above Node's default heap → OOM. Run `--stitch-gaps` on a
full map with a bigger heap: `NODE_OPTIONS=--max-old-space-size=8192`. (A structural fix — flat typed-array columns
instead of per-vertex `Vec3` objects — is the obvious future optimisation; the counts are known so it's mechanical.)

## Verification (in-game / viewer) — pending

map-viewer + in-game at the crack sites: confirm seams close with **no new tearing** and no UV smearing, and skirts
occlude without flapping. **Known limitation found in diagnosis:** the `vegassroad0522a` ↔ `vgssspagjun08` crack is a
road **ramp diverging from a slab in 3D** (the gap grows in Z as the ramp rises) — not a flat coplanar seam, so
variant A only welds the few meeting points and D's safe thresholds (horizontal, similar-height) deliberately don't
skirt it. Closing that class would need looser thresholds (risking over-skirting elsewhere) or variant C (a proper
bridge). Report: stitched pairs / T-junctions / skirts, models touched.

## Effort / risk

Medium-to-high effort, **higher risk than plan 016** — it **moves and adds geometry**, so a bad group visibly
tears the map (vs a mis-coloured vertex). The Phase-1 machinery is mostly reused from plan 016; the new work is
the band grouping + inverse transform (A), the **point-on-segment projection + edge split + fan retriangulation**
(B), the **skirt extrusion + horizontal/gap-adjacent gate** (D), bounds recompute, and — the real cost — **tuning
`minGap`/`maxGap`/normal-θ/`skirtDepth` in the viewer** against real cracks without welding intentional gaps or
flapping skirts. B and D both lean on the existing count-changing serializer (no codec work).

**Build order (each validated in the viewer before the next):**

1. **A** — position-only, lowest risk; proves the pre-pass + guards on real unique-tile cracks (the screenshot).
2. **B** — edge split; closes the T-junctions A can't, on the same unique tiles.
3. **D** — skirt; covers the instanced majority the census flagged (tiled roads / pavement), where A/B structurally
   can't reach.

Ship opt-in, validate visually at each step before promoting.
