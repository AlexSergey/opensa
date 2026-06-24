# 014 — Adaptive surface smoothing (roads / terrain)

**Status: ⛔ Not viable for SA terrain — won't pursue.** Phases 0 + 1.1 built (`--refine`, off by default); both
geometric-smoothing families were then tried and **both fail** (see "Verdict" below). Goal was: make road/terrain
surfaces look rounder by adding geometry only where there's real curvature. Conclusion: SA terrain has no
recoverable curvature, and relaxing it is destructive — so this stays off-by-default and unfinished by design.

## Verdict (why we stopped) — both approaches fail, confirmed empirically

Using the in-game **Show Faces** wireframe (engine debug) + measurements on `cuntwland07b`:

1. **Subdivision (PN / adaptive) adds polygons but changes nothing.** PN _amplifies existing curvature_
   (`displacement ∝ dot(edge, normal)`), and SA terrain is **piecewise-flat facets + sharp locked creases** —
   facet angles average ~9°, so midpoints land on the existing planes. The wireframe before/after shows denser
   triangles lying flat on the same surface; sharp ridges stay sharp. Crease-aware normals (the proposed Phase
   1.2) wouldn't change this — there's nothing to recover.
2. **Smoothing (Laplacian / Taubin) destroys the mesh.** A Taubin prototype (boundary-pinned) on `cuntwland07b`
   moved vertices **up to 20 m** (tile ~150 m) for only a modest angle drop (dihedral p95 90°→65°). The tile is
   genuinely angular (p95 90°, max 175° — real cliffs/embankments + double faces), and its irregular
   connectivity makes uniform relaxation wild. Rounding the "ridges" = flattening real terrain features.

Only **full remeshing** (resample each tile to a uniform grid → smooth → re-bake prelit/UVs → stitch across
tiles) could round SA terrain — a massive map-wide re-sculpt with collision drift, seam cracks, and (since the
world is unlit) a silhouette-only payoff. Not worth it. **The faceting is inherent to the source geometry.**

What _did_ land from this investigation: the curvature-scan tool (`analyze-curvature.ts`), the `--refine`
prototype (kept off by default), and the realisation that the real normal/SSAO win was **plan 015**
(smooth-group normals), not geometry subdivision.

---

_Historical design notes below (the path that led to the verdict)._

## The reframing that drives the design

Two engine facts change the usual smoothing playbook:

1. **The world is unlit.** `world-material.ts` never reads vertex normals for lighting (`texture × prelit`).
   So recomputing smooth normals — the cheap "fake roundness" trick — is **invisible** on the map (normals only
   feed the SSAO normal-prepass). Rounding a surface therefore requires **moving/adding real geometry**, not
   shading.
2. **Collision is a separate mesh (COL).** The car drives on collision, not the visual DFF. So this is **purely
   cosmetic** — silhouettes and the surface under the camera get rounder; the car doesn't _feel_ smoother.
   Smoothing COL is a separate, gameplay-affecting task, **out of scope**.

So the task = **adaptive geometric refinement**: subdivide + displace triangles onto a smooth interpolant,
denser where curvature is high, untouched where flat.

## Phase 0 — measure first (done)

`src/analyze-curvature.ts` + `src/analysis/curvature.ts`: select the instances in a world-space sphere, scan
each unique model's geometry, and classify interior edges by **dihedral angle** (flat / gentle / crease) and
triangles by **area**. A **refine candidate** = a large triangle touching a gently-curved edge. Adjacency is
welded by position (so SA's seam-split vertices aren't mistaken for boundaries). Dihedral + area are invariant
under a tile's rigid placement, so each DFF is scanned in **local space** — no map assembly needed yet.

**Findings (stock `original`):**

- **Urban (casino district, r=200):** only **3%** of area is refine-candidate — cities are flat + hard creases
  (buildings). The few candidates are curved building shells (`csrspalace`, `casroyale` domes), not roads.
- **Whole map:** **32% of surface area** (188k triangles) is refine-candidate, dominated by **terrain**:
  `cehollyhil*` (LS hills), `nw_bit_*` (wilderness), `cuntwland*` / `cunte_landf*` (Red County / Flint
  wasteland). These are the coarsely-tessellated **rolling hills** that read as faceted.

**Conclusion:** worth building, but the payoff is **terrain/countryside**, not city roads. Target the hill/land
tiles; the value is region-dependent (high in open country, ~nil downtown).

## Approaches considered

- **PN triangles / Phong tessellation (front-runner).** Build a curved patch per triangle from its corner
  positions + normals; insert vertices on the patch (interior bulges, corners pinned). Adaptive per-triangle by
  normal divergence. Reuses the crease-limited normals `recompute-normals` already makes, is local
  (seam-friendly), and naturally skips flat triangles.
- **Loop subdivision with creases.** Smoother continuity but _moves original vertices_ and rounds everything
  unless creases are tagged — higher risk of rounding curbs/footings. More global. Rejected as the default.
- **Heightfield resample** for near-planar terrain tiles. Cheap and ideal for rolling hills, but fails on
  overpasses/banking/tunnels. Possible fast-path, not the general engine.

## The central hard problem: tile seams

A terrain surface is many independent DFF tiles placed by IPL. If tile A bulges a shared border edge and tile B
doesn't, you get a **crack**. Two ways out:

- **Phase 1 (safe):** refine **interiors only** — leave every boundary/crease edge straight. Zero cracks, no
  cross-tile coordination, immediately shippable. Loses the seams themselves.
- **Phase 2:** assemble IPL instances → world space, position-key shared border vertices, compute a **shared
  boundary normal** so both tiles subdivide the seam into the _same_ curve. This is the "поднять часть карты"
  step — needed only for seam-spanning curvature.

## Reuse vs. new

- **Reuse:** crease-limited normals (`recompute-normals`); the **count-changing serializer** (`rebuildGeometry`
  already regenerates Struct / BinMeshPLG / night / bounds, and refuses skinned/multi-UV/multi-morph — terrain
  is single-UV non-skinned, so fine).
- **New:** the adaptive PN subdivision operator, incl. correct **UV** interpolation (textures must not swim —
  only subdivide within UV-continuous regions; displacement is mostly along-normal) and **prelit** Gouraud
  interpolation (a bonus: smoother shading bands); plus the Phase-2 map-assembly / spatial-adjacency layer.

## Phase 1 — prototyped (`plugins/refine-surface.ts`, opt-in via `--refine`)

Interior-only PN refinement: weld by position, derive an area-weighted normal field, mark **gentle interior
edges** between coarse triangles (boundary + crease edges locked), place midpoints on the PN patch, and re-emit
each triangle with conforming 1→2 / 1→3 / 1→4 templates (crack-free). Rides the count-changing serializer.

**Validated** on `cuntwland03b/46b/64b`: crack-free, **round-trips** through encode → re-parse (tri counts
match), **area preserved** (±0.3%, so no volume blow-up). But the **smoothness payoff from one level is
modest**: smooth-edge dihedral p95 only `30→29`, `28→27`, `34→31`; mean ≈ flat — at **~2× triangle count**.

Root cause: SA terrain facets are **huge** (35–120 m²/triangle), so a single split still leaves big curved
triangles, and the internally-derived normals aren't **crease-aware**, so the PN patch doesn't hug the smooth
surface tightly. (Count-based metrics like `refineCandidates` _rise_ after one level — they measure coarseness,
not smoothness; dihedral is the right gauge.)

## Phase 1.1 — done (crease-aware normals + multi-level depth)

- **Crease-aware normals.** The PN normal field is derived **per smoothing region**: faces around a welded
  vertex are union-find'd across **non-crease** edges only, and each region gets its own area-weighted normal.
  So a vertex where gentle terrain meets a cliff takes the terrain-side normal and the patch hugs the real
  surface instead of being flattened by the cliff.
- **Multi-level depth.** Each level re-fits + re-splits the finer mesh until triangles fall below the size/angle
  target; bounded by `maxLevels` + a per-mesh split budget.

**The decisive measurement (cuntwland sweep), and why we stop here.** Smooth-edge dihedral p95 **plateaus at
~27°** (from ~31°) regardless of budget:

| config           | triangles | p95  |
| ---------------- | --------- | ---- |
| baseline         | 1×        | 31.1 |
| 1 level, area 4  | 2.0×      | 28.5 |
| 2 levels, area 8 | 4.0×      | 27.0 |
| 4 levels, area 4 | 13.6×     | 27.0 |

Past ~4× triangles you buy **zero** further smoothing. The residual ~27° is **genuine near-crease terrain
structure** (ridges/embankments just under the 40° cutoff) — PN correctly subdivides the gentle slopes and
correctly leaves the angular features. So the real ceiling for SA terrain is **~4° of p95**, i.e. a **subtle**
visual change for a **3–4× triangle** cost. The default is set to the sweet spot (`maxLevels 2, areaThreshold 8`)
but **`--refine` stays off by default** — the cost/benefit doesn't justify enabling it broadly.

## Phase 1.2 — smooth-group-aware refinement (proposed, post-015)

Plan 015 now bakes proper **smooth groups + hard-edge vertex splits** into every world model. That supersedes
the weakest part of Phase 1.1 — the refiner no longer has to _guess_ creases from per-edge dihedral; the
smooth-group structure **is** the definitive "smooth here / keep sharp here" data a subdivision scheme wants.
The reworked operator:

- **Drive subdivision by smooth groups, not a dihedral threshold.** Subdivide _within_ a smooth group (where the
  surface is meant to be continuous) by curvature; leave **group boundaries** (the 015 hard-edge splits) crisp.
  No more guessing, and no risk of rounding a genuine feature that happened to sit under the dihedral cutoff.
- **Use the baked split normals for the PN patch.** Phase 1.1 derived its own area-weighted field; now the
  patch rides the high-quality 015 normals → vertices land closer to the intended smooth surface (the quality
  gap Phase 1.1 hit).
- Everything else carries over: conforming 1→2 / 1→3 / 1→4 templates (crack-free), interior-only in Phase 1,
  seam handling deferred to Phase 2, rides the count-changing serializer.

**Two truths this does NOT change — read before building:**

1. **The plateau is geometry, not normals.** Better normals improve _where vertices land_, but SA terrain's
   residual faceting is genuine near-crease structure (Phase 1.1's ~27° p95 floor). Expect _cleaner_, still
   _bounded_ — not a dramatic change.
2. **The world is unlit (the decisive one).** 015's smooth normals only feed SSAO; they don't round the visible
   shading or the silhouette. So geometric subdivision still only rounds **silhouettes** (prelit is already
   Gouraud-smooth across facets). And **015 likely already removed much of the _perceived_ faceting** — the bad
   normals were breaking SSAO at every facet (dark seams that read as faceting). With that fixed, terrain may
   look acceptable without any subdivision.

**Gate before implementing:** re-evaluate terrain **in-game now (post-015)**. If it still looks faceted, build
Phase 1.2 scoped to the worst tiles + budgeted, weighing the _additional_ size against the +40% already spent
on 015. If 015 already made it acceptable, this stays proposed and we stop here.

## Later steps (only if Phase 1.2 proves worth it in-game)

- **Phase 2** — map-assembly pre-pass + seam-consistent boundary smoothing (crack-free across tiles).
- **Phase 3** — decimate over-tessellated _flat_ terrain to offset the added triangles (net-neutral).

## Risks

- **Cracks at seams** (the dominant risk) — Phase 1 sidesteps by locking borders.
- **UV swimming** on textured terrain — subdivide only within UV-continuous patches.
- **Polycount blow-up** — strict curvature metric + per-tile budget; pair with Phase-3 decimation.
- **Cosmetic only** (collision unchanged) and **can't be auto-verified** — needs in-game A/B like the prelit work.
- This is the optimizer's first **additive** pass (everything else is lossless reduction) — keep it opt-in.
