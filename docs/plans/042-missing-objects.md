# 042 — Missing world objects: in-IMG IPLs + procobj scatter

## Context

Two known classes of world content we silently don't load:

1. **IPLs that live INSIDE gta3.img** (vanilla loads them straight from the archive; we only
   load IPLs listed in gta.dat from `static/data/maps/**`). Discovered while wiring the zone IFPs
   (plan 041): the extracted archive contents (`static/img/gta3anim/`) include
   `barriers1.ipl`, `barriers2.ipl`, `carter.ipl`, `crack.ipl`, `truthsfarm.ipl` — road barriers,
   Carter's place, the crack den, Truth's farm placements. None of these placements exist in our
   world today.
2. **procobj scatter** (carried from plan 004 "out of scope"): `data/procobj.dat` + COL surface
   materials drive procedurally scattered ground clutter (grass tufts, sea rocks, beach debris).
   The generic `procobj.ide` defs are already in the catalog; the scatter itself was never built.

## Iterations

1. **In-IMG IPL audit — DONE (2026-06-12).** Correction: they are **binary** (`bnry`), not text —
   the format `parseBinaryIpl` already reads; the files were already extracted to
   `static/ipl_binary/` (just unreferenced: no gta.dat entry, no `_stream` suffix → the manifest
   walk never finds them). Byte audit (all ids resolve in already-loaded IDEs):

   - `barriers1` (8 inst) + `barriers2` (16): `cuntw_roadblock*` (seabed.ide) — the SF/LV unlock
     roadblocks; vanilla REMOVEs them by script as the story opens the map.
   - `truthsfarm` (80): `grasshouse`/`grassplant` (counxref.ide) at Leafy Hollow (−1023, −1632) —
     present most of the game, removed after the farm-burning mission.
   - `carter` (2): `Carter_GROUND`/`Carter-light15b` (LAe2.ide) at (2533, −1290) — mission-state
     crack-palace pieces, east LS.
   - `crack` (60): `crack_wins_SFS`/`crack_int1` (SFSe.ide) around (−2164, −248) — mission/interior
     set; NB its `interior` field is 256 → low byte 0, so our `isInterior` filter would NOT drop it.

   These are CIplStore groups vanilla toggles by mission script (LOAD_IPL/REMOVE_IPL); when enabled
   they stream by bounding box like any sector. We have no scripts → the enabled set is OUR choice.

2. **Loader support — DONE.** `resolveMap(dat, base, { extraIpl })` fetches
   `ipl_binary/<name>.ipl` per configured basename (tolerant — missing skipped);
   `standaloneIplUrl` in resolve-paths; `GtaSaWorldConfig.extraIpl` threads it from canvas-host.
   **Decision (user): configurable list, default `['truthsfarm']`** — map stays open (no
   roadblocks), mission-state carter/crack off. `find-instances.ts` now also scans standalone
   `.ipl` files (dir scan, no manifest change). Tests: `resolve-map.test.ts` (mocked fetch,
   synthetic bnry buffer; negative: option absent / missing file). Debugger Position screen got a
   "Country - Truth's Farm" teleport (−1045, −1620, 76.4).

3. **procobj scatter — DONE.** Parse `procobj.dat` (surface name → object set, density,
   size/rotation ranges); hook into collision/COL surface materials per cell; deterministic
   per-cell scatter (seeded by cell coords) → instanced placements merged into the existing cell
   build. Density as a config knob (it's pure decoration with a perf cost).

   **3a — DONE (2026-06-12): parsers + config + debugger.**

   - Research: `procobj.dat` = ~95 whitespace-separated rules over 18 `P_*` surfaces;
     `surfinfo.dat` (user added) is the surface TABLE — **row order = COL material id** (179 rows,
     id 0 = DEFAULT … 178 = RAILTRACK), and the `P_*` rows ARE the procobj surface names — no
     extra mapping file. (`surface.dat` = legacy adhesion → later vehicle physics; `surfaud.dat` =
     surface audio → later sound work; neither needed here.)
   - `parsers/text/procobj.parser.ts` (`ProcObjRule`, 14 columns) + `surfinfo.parser.ts`
     (`parseSurfaceNames` — names by id); tests incl. shipped-file checks (179 surfaces, every
     procobj rule's surface resolves).
   - Config: `GraphicsConfig.procobj: ProcObjConfig` = `Record<ProcObjCategory,
     { density, drawDistance, enabled }>`; categories `grass/flowers/bushes/cacti/trees/rocks/
     underwater`; defaults in canvas-host (DD 50/50/80/100/150/80/60, density 1, all on);
     `game.setProcObj(category, patch)`.
   - Debugger: new root item **ProcObj** — per category ENABLED checkbox + DRAW DISTANCE (10–300)
     + DENSITY (0–3) sliders; `DebugActions.procObj()/setProcObj()` wired in canvas-host.

   **3b — DONE (2026-06-12): deterministic scatter (pure, offline-tested).**

   - `map/procobj-categories.ts`: `ProcObjCategoryName` + model→category map for every
     procobj.dat model; `procObjCategory(model, surface)` — `p_underwaterbarren` overrides to
     `underwater` (rubble rules reused on the sea floor follow the underwater toggle); unknown
     models fall back to `bushes`. (Renderware stays game-free: the union mirrors the game
     config's `ProcObjCategory` structurally.)
   - `map/procobj-scatter.ts`: `scatterProcObjects(colliders, rulesBySurface, surfaceNames, cx,
     cy)` → `ProcObjBatch[]` (per model, category resolved). Pure + deterministic: mulberry32
     seeded by cell coords; walk order colliders → transforms → faces → rules. Per face:
     world-space triangle (COL verts × placement Matrix4), area-weighted candidate count,
     sqrt-warped barycentric points (area-uniform), rule ranges for rotation/scaleXY/scaleZ/zOff,
     face normal kept (align flag).
   - **Density headroom trick**: candidates = `PROC_OBJ_MAX_DENSITY (3) ×` vanilla count, each
     with `lottery ∈ [0,3)`, batch sorted by lottery → renderer applies live density as a plain
     instance-count cutoff (`lottery < density`), no cell rebuild on the debug knob.
   - Vanilla MINDIST (SA's create-around-camera radius in CProcObjectMan) deliberately ignored —
     our placements are static per cell; visibility = per-category drawDistance (3c).
   - Tests `map/procobj-scatter.test.ts` (negative-first): unknown material / no rules /
     degenerate face → empty; determinism (same cell identical, other cell differs); exact 3×
     count + lottery sort + ~vanilla share below 1.0; in-triangle positions + range checks +
     normal; world transform applied; per-model batches with categories; category map cases.

   **3c — DONE (2026-06-12): rendering integration + live knobs.**

   - `map/build-procobj.ts`: batches → `InstancedMesh`es; models resolve via the IDE catalog
     (clutter defs ship in the generic IDEs; no def → batch skipped); transform =
     compose(position, tilt-to-normal (align) × spin-around-up, scale(s, s, sZ)); meshes start
     INVISIBLE (no full-density flash) and keep lottery order; `options.decoratePart` runs per
     part → the wind mod sways procedural bushes for free.
   - `map/procobj-runtime.ts`: mesh registry (mirror of animated-objects) —
     `updateProcObjMeshes(view, settings)` per frame: detached skipped, `enabled` toggles,
     `drawDistance` = bounding-sphere distance to the Z-up view, `density` = binary-search
     cutoff over the sorted lotteries → `mesh.count` (live, no rebuild).
   - Adapter: `prepare()` fetches `data/procobj.dat` + `data/surfinfo.dat` (both absent-tolerant —
     no files, no scatter) + builds `defByName`; `loadCell()` (HD only) appends the clutter
     meshes to the cached cell. canvas-host: `procobj` system applies `graphics.procobj` every
     frame (`updateProcObjMeshes(character.viewOf(), …)`).
   - `scripts/procobj-stats.ts`: offline sanity counts for one cell — per model / per category,
     vanilla (lottery < 1) vs full 3× capacity, + an area-weighted surface histogram (id, name,
     m², rule matches, top contributing model). Run: `npx tsx scripts/procobj-stats.ts <x> <y>`.
   - Tests: `procobj-runtime.test.ts` (disabled/detached/out-of-range/density-0 negatives;
     density cutoff; re-entry visibility) and `build-procobj.test.ts` (real DFF fixture:
     no-def/empty skips; transforms decompose to the placement; align tilts model-up onto the
     face normal; runtime integration count cutoff).

   **3c fixes (after browser verification):**

   - **Upside-down bushes**: COL face winding is inconsistent — ground faces could yield a
     (0,0,−1) normal, and `ALIGN=1` rules planted bushes upside-down (canopy buried, only the
     base cross poking out as flat X shapes). Fix: the scatter flips any normal with z<0 upward —
     clutter always grows OUT of the surface; covered by a reversed-winding test. Cacti
     (`ALIGN=0`) were never affected.
   - **Density calibration note**: our density 1 = the authored procobj.dat density; vanilla
     looks sparser because CProcObjectMan only creates objects within its ~60 m radius AND caps
     the whole pool at ~300 objects, strangling the authored spacing on large areas.
   - **Clutter collision** (`map/procobj-colliders.ts`): vanilla-faithful rule — a model collides
     iff it ships a COL (rocks `p_rubble*col`, cacti, trees do; grass/flower patches don't, so
     they stay walk-through). Pose = the render `placementMatrix` (scale included — vanilla
     leaves collision unscaled, but that is a dat-format limitation, not a feature; matching the
     visual pose is strictly better). Adapter: `cellProcObjBatches(cx, cy)` — one deterministic
     scatter shared by the render and collider paths, so visuals and physics always agree;
     `loadCellColliders` appends the clutter colliders (cached per cell).
   - **Live collision sync** (after the "collider stayed where the rock vanished" report):
     the collidable subset is `lottery < densityOf(category)` (0 when disabled) — exactly the
     rendered set. Update chain: `GtaSaWorldConfig.procObjDensityOf` (canvas-host reads the live
     `graphics.procobj`) → debug `setProcObj(density|enabled)` → 300 ms debounce →
     `adapter.invalidateColliderCache()` + `CollisionStreamingSystem.reload()` (drops all bodies;
     the next update re-streams cells with the new density). Tests: density variants in
     `procobj-colliders.test.ts`, reload in `collision-streaming.system.test.ts`.
   - **procObjLimit** (after the physics-lag report — the very reason vanilla pools at ~300):
     ONE per-cell cap drives both rendering and collision. `procObjLotteryCap(batches, limit)`
     computes the cell-wide lottery threshold below which exactly `limit` placements fall
     (lowest lotteries win — the most-vanilla subset, stable under density changes); the runtime
     cuts each mesh by `lottery < min(density, cap)`, and `procObjColliders` takes the same
     `lotteryCap` — what isn't rendered is never collided. Configured via
     `GtaSaWorldConfig.procObjLimit` (canvas-host: 150/cell; collision radius 150 ⇒ ~4–9 live
     cells). Tests: cap threshold (scatter), runtime cutoff capping, collider lotteryCap.
   - **Picking**: `describe()` understands `userData.procObj` — clicking clutter reports
     `model [procobj: category]` + the instance-matrix position. Resolved the "bushes inside
     ROCKS" report: that is `sm_scrub_rock3` (txd `gtarock_deserts`), a rock model WITH scrub
     growing from it — the greenery is part of the model, not a parsing bug.

4. **Verification — DONE (2026-06-12).** Truth's farm populated (greenhouses + plants at Leafy
   Hollow; debug teleport added); barriers/carter/crack stay off by the configured world-state
   choice. procobj verified in browser across desert (joshua trees, bushes — upright after the
   normal-flip fix), mountains (rubble boulders + sm_scrub_rock3), grass country; clutter
   collision matches the rendered set and follows the live knobs; `procObjLimit: 150` keeps
   physics smooth (the lag with unlimited bodies was reproduced and was the motivation — same
   reason vanilla pools at ~300). Density defaults left at 1: with the per-cell limit dominating,
   the authored densities read well. `scripts/procobj-stats.ts` (+ surface histogram) is the
   offline sanity tool.

**Plan complete (2026-06-12).**

## Out of scope

Mission scripting (enabling/disabling crack/carter by progress), interiors, `occlu` sections.
