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

**Plan complete (2026-06-12): items 1–4 + the item 5 follow-up (road-sign text).**

5. **Road-sign text (2dfx ROADSIGN, type 7).** Street-name plates / route signs carry their TEXT
   inside the DFF: the geometry's 2d Effect plugin (`0x253F2F8`, the same section our corona
   lights come from — `parseLightEffects` currently skips every non-light type by size) has
   entry type 7. **Byte layout (verified empirically via `scripts/find-2dfx.ts` — the first
   survey misread it and the garbage pinpointed the truth): `plate size vec2 (8B), rotation
   vec3 (12B), flags u16 (2B), text 4 lines × 16 chars (64B), pad (2B)` = 88 bytes.** Plate
   sizes read plausibly (5×2 m highway boards, 4×3 / 6×3 plates); flags to decode on the
   corrected offsets (lines-count / chars-per-line / colour). Text alphabet: `_` = space,
   `> < ^ # %` = arrow glyphs, `}` = airport symbol, `~` observed — the glyph atlas mapping must
   cover them. Survey: **112 roadsign entries across 43 models** (Vegas motorway boards + street
   plates; full 2dfx census: type 0 lights 436, 1 particles 58, 3 ped attractors 173, 6 enex 26,
   7 roadsigns 112, 8 trigger 8, 9 cover points 3144). Vanilla `CCustomRoadsignMgr` generates one
   textured quad per character from the **`roadsignfont`** glyph atlas — confirmed present in our
   `models/particle.txd` (already loaded by canvas-host for the moon sprite). Text lives in the
   MODEL, so all instances share it → the sign text becomes an extra static `RenderPart` and
   stays on the instanced path.

   Iterations:
   - **5a — survey + parser.** `scripts/find-2dfx.ts` (done): raw-scan all extracted DFFs,
     histogram 2dfx types, decode every roadsign entry (model/flags/text) — establishes corpus
     and validates the byte layout. Extend the dff 2dfx parser: type 7 →
     `RWRoadsign { position, rotation, flags: { lines, charsPerLine, colour }, lines: string[] }`
     on `RWGeometry.roadsigns`; real-asset fixture + tests (negative: light-only models
     unaffected).
   - **5b — glyph atlas + mesh — DONE (2026-06-12).** `roadsignfont` decoded by eye via
     `scripts/dump-texture.ts` (PNG dump, alpha-as-grayscale + reflow/zoom): 32×512, 4 columns ×
     32 rows of 8×16 px cells; cells 0–81 = ASCII in order minus the command characters
     (`!"&'()+,-./0-9:;?A-Z[\]a-z{|}`), 82+ = arrows ←→↑↓↖↗↙↘, fractions, ¢, airplane, skull,
     special icons. Command chars map onto the appended cells (`<`→←, `>`→→, `^`→↑, `}`→plane,
     `~`→skull, `#`/`%`→diagonal exit arrows — single `COMMAND_GLYPHS` table to adjust on visual
     check). `src/renderware/three/build-roadsign.ts`: quad per glyph, plate layout from
     plateSize/charsPerLine/lines, XYZ-degree rotation, colour-batched parts (palette
     white/black/grey/red), alpha-tested DoubleSide font material; `setRoadsignFont` registry
     fed by canvas-host from the already-loaded particle.txd.
     **CRITICAL FINDING (first in-browser run showed nothing):** roadsign entry positions/
     rotations are baked in **WORLD space** — unlike the geometry-local light entries (verified:
     entries land on real city spots — Grove Street (2348, −1648) — while host chunks are placed
     elsewhere; placement+entry would leave the map). So signs do NOT ride the instanced path:
     `buildRoadsignMeshes` (build-region) emits static meshes at identity per HD cell;
     `buildCell` appends them. Regression test pins the world coordinates.
     **Orientation — final, solver-verified:** base plate flat (width +X, lines advance −Y,
     text normal −Z), entry Euler applied **Z→X→Y**, angles as stored. Found by
     `scripts/solve-roadsign.ts`: brute force over Euler orders × angle signs × angle→axis maps
     × base triads, requiring every observed rotation family ((90,0,0), (−90,0,±180),
     (±90,±90,±90), (0,±90,±90), (180,90,90), (90,−90,−90)) to come out upright, lines-down and
     unmirrored — the unique solution class. Hand-guessed X→Y→Z looked right on the 90°-multiple
     boards near the calibration site but rolled the (±90,±90,±90) family by 90° (exposed by the
     PF-added vegasmotsignCJ gantry at (1790, 1934) — vanilla has no board there, so the floating
     text's roll was invisible on the original archive). `TEXT_INSET = 0.85` keeps the
     vanilla-style margin between the glyph grid and the board edge. Line slots are a FIXED
     quarter of the plate height with the block centred vertically (dividing by the actual line
     count stretched 1–2-line boards into giant letters). **Each glyph renders TWICE at ±0.05 m with
     identical UVs (DoubleSide):** entry positions sit ON the board plane and the face direction
     varies by rotation family — a single one-sided quad ended up buried inside thick boards
     (desert `se_bit_17` signs invisible while the offline pipeline was provably clean; great
     user catch that only later-streamed zones seemed affected — the actual variable was the
     rotation family, not streaming). The copy on the visible side hugs the board, the other
     stays buried; identical UVs overlap into one letterform (readable from the front, mirrored
     from behind — vanilla behaviour). Dead ends, documented to avoid repeats: FrontSide
     winding-culling culled everything; mirrored back-side UVs showed mirrored text where the
     back quad was the visible one; ±0.12 m offsets made the text float off the face. Known PF data quirks (not our bugs,
     reproduce in real SA+PF): some vegasmotsignCJ gantries sit slightly rotated/offset vs the
     vanilla text entries (text sinks into the board / pokes out half-hidden), and boards with no
     entry for one direction are blank on that side — vanilla-accurate.
   - **NB (user-verified in vanilla): many boards are simply EMPTY in the original game too** —
     a blank board in our port is not automatically a missing-text bug; check the 2dfx survey
     (`scripts/find-2dfx.ts`) for an entry at that location before chasing it.
   - **5c — verification — DONE (2026-06-12).** Julius Thruway boards verified against vanilla:
     text readable with margins, plates vertical on their gantries, plane glyph on AIRPORT,
     right/down arrows correct. Fixed by comparison: `~` = ↓ (lane indicators on the boards'
     bottom row), not the skull guess. `scripts/find-2dfx.ts` now byte-steps (a 4-byte stride
     missed unaligned 2dfx chunks — the survey undercounted; runtime parsing was always
     complete). Remaining best-effort: `#`/`%` mapped to diagonal exit arrows ↗/↖ — adjust the
     single `COMMAND_GLYPHS` table if a real board disagrees.

## Out of scope

Mission scripting (enabling/disabling crack/carter by progress), interiors, `occlu` sections.
