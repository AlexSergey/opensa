# 016 — Weld prelit across seams (adjacent unique models)

**Status: ✅ Implemented (opt-in `--weld-seams`) — pending in-game visual verification.** `adapters/gta-sa/seam-weld.ts`
(pure Phase-1 core) + `adapters/gta-sa/resolve.ts` `resolvePlacements` + the adapter's `buildSeamOverrides` +
`plugins/weld-seam-prelit.ts` (Phase-2 apply). A full run over the re-export map welded **161 220 seam groups over
7671 uniquely-placed models** (3521 groups skipped by the spread guard), 0 failures, output byte-size unchanged
(RGB-only rewrite). One deviation from the design below: the world transform is a small pure quaternion-conjugate
routine (`transformToWorld`, unit-tested against the convention) rather than a call into the engine — there is no
single exported point-transform helper to reuse, and the tools stay dependency-free (no `three`). A new
**opt-in** world-context pass (`--weld-seams`) that removes the visible
**brightness discontinuity on the seam line** between two neighbouring map models by averaging their **prelit
RGB** at world-coincident boundary vertices. Conservative by construction: touches **only** boundary vertices of
**uniquely-placed** models, **RGB only** (alpha verbatim), off by default. Variant "A" of the prelight-smoothing
investigation — the safe, low-risk half. Level normalisation across a neighbourhood ("B") and T-junction seams
are explicitly out of scope here.

## Context / problem

The world renders **unlit**: `texture × mix(day prelit, night prelit, dnBalance) × worldTint`
(`world-material.ts`, plan 038). Prelit is a **baked per-vertex RGBA** — AO + base light. Where two different
DFFs sit next to each other (adjacent terrain/road tiles), a difference in their baked **average level** shows as
a hard **seam** along the shared edge.

The existing prelight passes are **per-asset** — they see one model, zero world context:

- `condition-prelit` (plan 012) — pulls only outlier models (mean outside `[24, 248]`) toward a **global**
  constant `targetLuma = 200`. A crude global level match, not neighbour-aware.
- `synthesize-night` (plan 013) — derives a night set from day prelit per-model.

Neither can close a seam, because a seam is a **relationship between two models** and needs their **world
placements** to even locate.

### The hard constraint: prelit is per-MODEL, models are instanced

Prelit is baked into the **DFF geometry**, and one DFF is placed many times across the map (~**x5** on average:
opensa-lod-generator counts 30981 exterior instances over 5958 unique models). Editing a model's prelit to match
**one** neighbour changes it at **every** other placement, where it has **different** neighbours. Standard
RenderWare has **no per-instance vertex colour**, so there is nowhere to store a per-placement correction.

**Consequence:** this pass only touches models placed **exactly once** (terrain tiles, road sections, unique
landmarks) — where a prelit edit is local by definition. Heavily-instanced props are left to the global
`condition-prelit`.

## Approach — two phases

### Phase 1 — world pre-pass (`adapters/gta-sa/`, new module)

1. Parse **all** non-interior placements (text `parseIpl` + binary `parseBinaryIpl`). `resolve.ts` already runs
   both parsers but keeps only `id`; extend it to surface the full instances (position + rotation quaternion).
2. Count placements **per model name**; a model **qualifies** only when it is placed exactly once.
3. For each qualifying model, mark **boundary vertices** — those on an **open edge** (an edge used by a single
   triangle), the same criterion `smooth-normals` uses. On a tile this is its outer contour.
4. Transform each boundary vertex to **world space** by the instance transform. This MUST use the **same
   IPL conjugate-quaternion convention as rendering/collision** (reuse the engine's instance-transform helper —
   read-only; do not reimplement) and **no scale** (SA IPL carries none). Map models **ignore DFF frame
   transforms** (map-pipeline.md), so world = `instanceTransform × localPos` directly — matching what the map
   actually draws, so the computed seams are the visible ones.
5. Insert world boundary vertices into a **spatial hash** (grid quantised by `weldEpsilon`), tagged with
   `{ modelName, localPos, rgb }`.
6. A **seam group** = boundary vertices from **≥ 2 distinct models** within `weldEpsilon`. Compute a blended RGB
   (default: mean) and emit overrides keyed by **local position**:
   `Map<modelName, Array<{ localPos, rgb }>>`.

### Phase 2 — apply (`plugins/weld-seam-prelit.ts`, new plugin)

- The plugin is constructed with the precomputed override map (closure): the CLI runs Phase 1, then builds the
  pipeline config with the plugin bound to the result.
- For the current model it looks up vertices by **local position** and overwrites their prelit **RGB**; **alpha
  is copied verbatim** (wind sway / floodlight cone / overlay data — same rule as the other prelight passes).

## Three correctness points (each breaks the pass if missed)

1. **Vertex indices are NOT stable through the pipeline.** `weld-vertices` / `prune-vertices` / `smooth-normals`
   re-index and split vertices. Therefore overrides are keyed by **local position, not index** — position is
   invariant under weld/prune (dedup doesn't move points) and under smooth-normals (split copies keep their
   position). Every split copy at a seam position then matches and gets the welded colour for free.
2. **Plugin ordering.** Apply **after `smooth-normals`** (so all split copies at the seam are covered) and
   **before `synthesize-night`** (so the night set is derived from the already-welded day prelit — variant "C"
   comes for free, no separate night weld).
3. **Transform convention.** Any mismatch in the quaternion/`lod`-space convention places seams in the wrong
   spot. Reuse the engine helper the world grid / colliders already use.

## Tuning knobs

- `weldEpsilon` (world units, ~0.01–0.1) — coincidence tolerance. Too small → misses seams from float32 drift;
  too large → false welds (an overpass edge onto the road beneath it).
- **Normal guard** (optional) — weld only vertices whose **world-space face normals** agree, so a raised edge
  doesn't fuse to a surface below it. Derive from faces (prelit models are often normal-less at read time).
- **Discontinuity clamp** (optional) — skip (or clamp the shift for) groups whose members differ by more than a
  threshold: averaging a bright tile with a near-black one only yields a mid-grey seam that still reads as wrong.
  That case is a **level-normalisation** problem (variant "B"), not a weld — **log** such groups as B candidates.
- **Area weighting** (optional) — weight the blend by triangle area at the vertex. With instanced props already
  excluded, the qualifying set is mostly tiles where a plain mean is fine; default to mean.

## Guards / conservatism

- Only **boundary** vertices, only **RGB**, only **unique-placement** models → interior baked AO is untouched;
  the map's intended contrast survives (heeds the standing caution: _flattening prelit looks worse — fill gaps,
  don't equalise_). We fix the **seam line**, nothing else.
- Skip vertices with no prelit; interiors already filtered; `lod*` excluded by default (far seams, low value) via
  a switch.
- Opt-in `--weld-seams`; default pipeline byte-identical when the flag is absent.

## Edge cases / limitations

- **T-junctions** (a vertex of tile A lands mid-edge on tile B with no coincident vertex) never match → not
  welded. A known limit of A; that seam class needs remesh / variant B. Log a count.
- **`condition-prelit` interaction.** Phase 1 reads raw prelit; if a seam model is later conditioned (outlier
  shift toward 200) the seam target is mildly out of sync. In practice `condition` only touches flat-black /
  fullbright outliers — exactly the models a weld should probably leave alone — so apply after `condition` and
  accept/log it, or exclude conditioned models from welding.

## Real-data finding (stock SA) — efficacy caveat

A scan of the stock map (`resolvePlacements` + boundary coincidence) shows **adjacent _different_ HD tiles rarely
share exact vertices** — SA terrain meets at T-junctions, so genuine HD↔HD vertex-coincident seams are scarce
(the strongest clean pair found is `cf_ext_dem_sfs`↔`crackfact_sfs`, two co-located San Fierro shells — the test
fixture). The overwhelming majority of coincidences are **HD↔far-LOD** (an HD tile and its own `lod*` / `*_lodbit_*`
baked from the same silhouette). Those are **not visible seams** — streaming swaps HD and its LOD, they never
co-render — so welding them is pointless (and mildly harmful: it pulls the HD boundary toward the LOD's cruder
prelit).

**LOD exclusion (implemented, default on).** `buildSeamOverrides` drops `lod*` models via the engine's
`isLodModel` (`@opensa/renderware/parsers/text/lod`, `name.startsWith('lod')`) — **the same LOD gate every LOD
tool uses** (opensa-lod-generator, lod-trees-generator). `--weld-seams` can override with `includeLods`. Why the
plain name gate and not the `hasHdTwin` refinement (opensa-lod-generator `resolve.ts`): for welding, `isLodModel`
is both simpler **and safer** here. A true far-LOD like `lodcuntw01` is `lod*`-prefixed → excluded; but its HD
twin is `cuntwland03b` (names don't prefix-match), so `hasHdTwin` would find _no_ twin, treat `lodcuntw01` as base
geometry, and wrongly weld it back to `cuntwland03b`. This is not an edge case: on stock, **3055 of the 3921
uniquely-placed `lod*` models have no name-matched twin** (`lodroadf48`, `lodclubblock02`, …, overwhelmingly
far-LODs), so an `isLodModel && hasHdTwin` gate would **re-admit ~3000 far-LODs** into welding. Plain `isLodModel`
avoids that; it over-excludes only genuine base-geometry `lod*` (the 866 with a twin are the redundant ones it
_should_ drop) — accepted: a rare missed weld, never a wrong one. `hasHdTwin` was still factored out to
`@opensa/map-placement/lod-twin` (shared with opensa-lod-generator, whose bake-vs-strip use _wants_ the
twin semantics); the seam weld just doesn't use it. Note `_lodbit`/`_lod`-named tiles are **not** `lod*`-prefixed,
so the engine treats them as HD-tier (co-visible) and they still weld — correct.

Net: variant A is correct and safe but closes **few genuine visible seams** on stock SA; its real value is likely
on **re-export / total-conversion maps** whose adjacent tiles _do_ share welded vertices. Revisit efficacy before
promoting it past opt-in.

## Integration points

- `cli.ts` — add `--weld-seams`.
- `adapters/gta-sa/resolve.ts` — surface full placements (currently ids only).
- `adapters/gta-sa/<new>` — the Phase-1 world pre-pass (placements → boundary verts → spatial hash → overrides).
- `plugins/weld-seam-prelit.ts` — the Phase-2 apply plugin.
- `optimizer.config.ts` — include the apply plugin **conditionally** (flag set + non-empty overrides), positioned
  **after `smooth-normals`, before `synthesize-night`**.

## Engine stays untouched

Same discipline as the rest of the tool: the engine (`packages/**`, the `@opensa/*` parsers) is **read-only
reuse** — IPL parsing, the instance-transform helper, the DFF codec. **No change to `packages/`.** All new code
lives under `tools/map-optimizer/`.

## Testing

**Synthetic unit tests** (no fixtures) for the core:

- two tiles sharing one edge → the shared boundary vertices become the mean of both; **interior vertices
  untouched**; **alpha preserved**.
- a model placed **twice** is **skipped** (instancing guard).
- `weldEpsilon` boundary: just-inside coincidence welds, just-outside does not.
- optional normal guard: an overpass edge above a road does **not** weld.
- T-junction: a mid-edge landing produces **no** weld.

**Real-asset integration test** via the existing fixture mechanism (`npm run test:fixtures`, see
`docs/development/getting-started.md`): fixtures are **regenerated locally** from a clean `game-src/non-modified`
into the gitignored `tests/original/` by the **MANIFEST in `scripts/test-fixtures.ts`** (types `copy` / `extract`
/ `archive`) — Rockstar assets are never committed. This is **build tooling, not the engine**; extending the
MANIFEST is allowed.

- Add two **adjacent, uniquely-placed** world tiles (`extract` their `.dff` from `gta3.img`) **plus the IPL that
  places them** — the fixture set already carries usable placement pairs (`ipl_text/lae.ipl` +
  `ipl_binary/lae_stream0.ipl`; `ipl_text/countrye.ipl` + `ipl_binary/countrye_stream1.ipl`) and `world/` tile
  DFFs (`world/compfukhouse3.dff`, `world/mcstraps_LAe2.dff`) as precedent.
- Assert: after the pass, the two tiles' shared-edge vertices agree (seam closed) while their interiors are
  unchanged, and a control model placed multiple times is left alone.
- Custom, non-reproducible-from-stock cases (if any) go **committed** under `tests/custom/` instead.

## Verification (in-game / viewer)

- map-viewer, **day and night**, "Show LODs" off — compare a known tile seam before/after.
- Run report: seam groups welded, models touched, **max RGB shift** (large shifts flag variant-B candidates),
  T-junction skips.

## Effort / risk

Medium effort, **low risk** — boundary RGB of unique models only, opt-in. The real work is the Phase-1 world
pre-pass (correct world transform + position-keyed overrides); the weld itself is a mean. Main pitfalls are the
three correctness points above: **position (not index) keys**, **plugin ordering**, **transform convention**.
