# 009 — World streaming + LOD rendering (sectioned grid)

## Goal

Render the map the way GTA SA does: the area around the view is drawn as **full-detail (HD) models**, and
everything farther out is drawn as **low-detail LODs**, with the world divided into **grid cells (squares)**
that stream in/out as the view moves. **Draw distance is configurable** for both HD models and LODs. This
replaces today's single static region load and is the **StreamingSystem** the engine was scaffolded for
(plan 006 dynamics roadmap; rides on the `System` registry + the player/camera view).

## How GTA SA actually does it (reference)

- **Per-instance draw distance.** Each object def in the IDE carries a `drawDist` (we parse it as
  `IdeObjectDef.drawDistance`). An HD instance is drawn while the camera is within `drawDist` (scaled by the
  game's draw-distance slider); beyond that it is culled.
- **LOD models + links.** SA adds explicit low-detail stand-ins (model names conventionally `lod`-prefixed —
  our `isLodModel`). Each placed instance has a **`lod` field = the index of its LOD instance** (or −1; we
  parse it as `IplInstance.lod`). The LOD instance is itself a placed object with a **much larger drawDist**.
  When the HD instance is culled (too far), the engine draws the linked LOD instead. Net effect: **near = HD,
  mid = LOD, far = nothing** — exactly the "active part full, surroundings LOD" the user wants. LOD meshes are
  coarser and often one LOD covers a whole block of HD buildings.
- **Sectors.** `CWorld` buckets the world (~6000×6000 units) into a **sector grid** for spatial queries
  (which objects are near the camera). SA streams model/texture *data* in/out of memory by proximity too —
  not relevant for us (our WIMG archive is fully in memory; "streaming" here = which meshes are in the scene
  graph).

## What we already have

- `MapDefinitions` = `catalog: Map<id, IdeObjectDef>` (+ `drawDistance`, `flags`) + `instances: IplInstance[]`
  (each with `position` Z-up, `rotation`, `interior`, **`lod` index**, `id`). `isLodModel(name)`.
- `buildRegion(archive, defs, { center, geometry: 'lods'|'map', radius })` → `InstancedMesh[]` — filters to
  `interior===0`, a geometry kind, and a radius; groups by model+txd; one `InstancedMesh` per part. This is
  the per-call builder we generalize to **per cell**.
- The adapter wraps region meshes in one −90°X group; `Game.loadGame` adds it to the scene statically. The
  debug overlay toggles `geometry: 'lods'|'map'` (force one kind) and `camera: ganton|full-map`.

## Our design — grid streaming with HD/LOD rings

A pragmatic approximation of SA, grid-based (cheap load/unload of whole cells instead of per-frame culling of
~36k instances):

1. **World grid.** Bucket all exterior (`interior===0`) instances into 2-D cells of size `cellSize`
   (configurable; cell `(cx,cy) = floor(x/size), floor(y/size)`), splitting each cell's instances into **HD**
   (`!isLodModel`) and **LOD** (`isLodModel`) lists. Built once after `resolveMap`.
2. **Per-cell meshes, cached.** `buildCell(archive, defs, cx, cy, lod)` builds the `InstancedMesh[]` for one
   cell's HD or LOD instances (same grouping/transform as `buildRegion`, conjugated quat, `userData.region`
   for picking). Cached by `(cx,cy,lod)` so re-entering a cell is free.
3. **HD / LOD rings.** Each frame (throttled — only when the view crosses into a new cell), from the view
   position compute the target cell sets: cells within `hdDrawDistance` → show **HD**; cells within
   `lodDrawDistance` but outside the HD ring → show **LOD**; everything else → unloaded. As the view moves, a
   cell transitions LOD → HD → (closer) and back, and far cells unload.
4. **StreamingSystem** diffs the desired cell set against the loaded set: `loadCell` for new, remove + dispose
   for gone (disposing geometry/material; textures are shared — kept, like today).

Result: full models around the player, LODs ringing them out to the LOD distance, squares streaming as you
move — "more-or-less like the real game", both distances tunable.

## Module structure

```
src/renderware/map/
  world-grid.ts        # buildWorldGrid(defs, cellSize) -> WorldGrid: Map<cellKey,{hd:IplInstance[],lod:IplInstance[]}>
                       #   + cellKey(cx,cy), instanceCell(pos,size). Pure, no three.
  build-cell.ts        # buildCell(archive, defs, grid, cx, cy, lod) -> InstancedMesh[] (reuses build-region grouping)
src/game/streaming/
  streaming.system.ts  # StreamingSystem (System.update, throttled). Two modes:
                       #   - 'stream': view cell → desired HD/LOD ring cells → diff loaded → loadCell/unload.
                       #   - 'manual' (debug): desired set = an explicit cell list + a single kind (HD|LOD),
                       #     set by the debug overlay; same diff/load/unload. Mode follows debugMode.
                       #   Both add/remove under one streaming root. Exposes the current view cell + cellSize
                       #   for the debug grid; setManualCells(cells, lod).
  grid.ts              # generic ring math: cellsWithin(centerCell, radius, cellSize) (no renderware)
src/game/interfaces/
  world-adapter.interface.ts  # + streaming surface (cellSize, loadCell(CellRequest) -> Object3D[])
src/game/adapters/
  gta-sa-world.adapter.ts     # implement loadCell via world-grid + build-cell (only renderware importer)
```

`StreamingSystem` + `grid.ts` are **generic** (game layer, no renderware) — they reason in cell coords +
distances and call the adapter. The grid bucketing + per-cell mesh build live in `renderware` behind the
adapter. Boundary stays intact.

## Config (new `Config.streaming`)

```ts
interface StreamingConfig {
  cellSize: number;          // grid cell edge in world units (e.g. 250 — a block-ish; tunable)
  hdDrawDistance: number;    // full models within this distance of the view (e.g. 300)
  lodDrawDistance: number;   // LODs within this (beyond HD) (e.g. 1500)
}
```

The user's "draw distance for normal models and LODs" = `hdDrawDistance` / `lodDrawDistance`. "Squares
roughly like the real game" = `cellSize` (SA HD draw ≈ 300, so a ~250 cell + 300/1500 rings approximates the
feel). All live-tunable via `setConfig` (the StreamingSystem reads them and re-evaluates).

## Engine wiring

- **Streaming root.** A `Group` (like `entityRoot`, −90°X) holding streamed cell objects, so cells render in
  GTA Z-up aligned with the player. (The adapter can keep wrapping per-cell, or the Game owns one root — pick
  one −90°X owner; recommend a single streaming root, cells added without their own rotation.)
- **View.** The StreamingSystem centers on the **view position** (GTA Z-up): the player while playing, else
  the camera target. Provide it via a `() => Vec3` from `Game` (reads player/camera) — the `view` seam from
  plan 006.
- **`Game.loadGame(center)`** seeds the view at `center` and starts streaming instead of a one-shot region
  load; the StreamingSystem fills cells around the view. Keep a fallback/whole-map path for debug.
- **Debug overlay = a section inspector (no force-HD/LOD switch).** Entering debug mode **suspends streaming**
  and switches the StreamingSystem to a **manual** mode that renders an explicit set of cells. The overlay
  shows a compact **N×N grid of checkboxes** for the cells around the current view cell (centre = the section
  the player is in, checked by default; each checkbox labelled with its absolute `(cx,cy)`), so you can tick
  **additional sections** to view them alongside — not just the current one. A single **"Show LODs"** toggle
  renders the checked sections as **LOD** instead of HD (the old force-LOD/force-HD, now per the manual
  selection). Leaving debug mode **resumes the normal streaming flow** (HD/LOD rings around the view). (The
  `geometry: lods|map` and `camera: ganton/full-map` toggles are replaced by this.)

## Phased iterations (each keeps `npm test` + the app green)

1. ✅ **World grid (pure) — DONE.** `renderware/map/world-grid.ts` — `buildWorldGrid(defs, cellSize)` buckets
   exterior instances into `{hd,lod}` per cell (`GridCell`/`WorldGrid`), `cellKey(cx,cy)`,
   `instanceCell(pos,size)`. Exported via `map`/renderware barrels. 5 unit tests (floor/key, skip no-def +
   interior, bucketing, HD/LOD split); 148 total green; tsc + eslint clean. No behaviour change.
2. ✅ **Per-cell build — DONE.** Factored `addToGroup` + `buildInstancedMeshes` out of `build-region.ts`
   (`buildRegion` reuses them; behaviour unchanged). `renderware/map/build-cell.ts` — `cellGroups(defs,cell,lod)`
   (pure: select HD/LOD + group by model|txd) + `buildCell(archive,defs,grid,cx,cy,lod)→InstancedMesh[]`
   (`[]` if the cell isn't in the grid). 5 unit tests (cellGroups HD/LOD select + grouping + skip-no-def;
   buildCell missing/empty cell → []); 153 total green; tsc + eslint + build clean. No behaviour change.
3. ✅ **Generic grid math — DONE.** `game/streaming/grid.ts` (no renderware) — `cellOf(pos,cellSize)`,
   `cellsWithin(pos,radius,cellSize)` (circular: a cell is in iff its nearest point ≤ radius — corners beyond
   excluded), `cellKey(cx,cy)`, `CellCoord`. 4 unit tests (floor/key; radius reaches no neighbour → view cell
   only; reaches a neighbour across an edge; excludes a corner cell). 157 total green; tsc + eslint clean.
4. ✅ **Adapter cell seam — DONE.** `WorldAdapter` gained `readonly cellSize` + `loadCell(CellRequest{cx,cy,lod})`.
   `GtaSaWorldAdapter`: builds the grid once in `prepare` (`buildWorldGrid(defs, cellSize)`); `loadCell` →
   `buildCell` (native Z-up — **no per-cell −90°X**, the streaming root applies it), cached by `(cx,cy,lod)`.
   `GtaSaWorldConfig.cellSize` (bootstrap passes `250`). 3 unit tests via `vi.mock` partial-stub of
   `loadArchive`/`resolveMap` (grid/cell builders stay real): throws before prepare, exposes cellSize, caches
   (same array on repeat). 160 total green; tsc + eslint + build clean. No behaviour change (loadCell unused yet).
5. ✅ **StreamingSystem (stream + manual modes) — DONE (class + seam; not wired yet).**
   `game/streaming/streaming.system.ts` `StreamingSystem` — `stream`: view cell → HD ring (`hdDrawDistance`) +
   LOD ring (`lodDrawDistance` beyond HD) via `cellsWithin` → diff loaded → async `adapter.loadCell` adds under
   the streaming root, unload removes (no dispose — adapter caches); guards double-load + add-if-still-current.
   `manual` (debug): `setManualCells(cells, lod)`, active while `debugMode`. `Config.streaming` +
   `Game.getStreamingRoot()` (−90°X Group). Bootstrap defaults (hd 300 / lod 1500) + shared `CELL_SIZE 250`.
   4 unit tests (HD/LOD rings; view-move reconcile; manual; manual ignored outside debug). 164 total green;
   tsc + eslint + build clean. **Not yet registered** (no render change) — wiring is iteration 6.
6. ✅ **Wire-in + debug section inspector — DONE (browser acceptance ✅ confirmed — streaming works, no lag).** Bootstrap creates +
   registers `StreamingSystem` (view = player `Transform` via `setupCharacter`'s `ctx.viewOf`); `Game`:
   `setStreamingSystem`/`setManualCells`/`getViewCell`, `pick` now raycasts the streaming root. `loadGame`
   simplified to prepare + collision zone (no static region). **Static path removed:** `WorldAdapter.loadRegion`
   + impl, `buildRegion` + `RegionOptions`, `worldObjects` — kept `addToGroup`/`buildInstancedMeshes`/
   `RegionMeshData`/`RegionRequest`. Debug overlay reworked: dropped `geometry`/`camera` toggles; added a
   **SECTIONS** 5×5 checkbox grid (around the current cell) + a **Show LODs** toggle → `setManualCells`; enter
   debug = manual mode, leave = resume streaming. 164 tests green; tsc + eslint + build clean. Browser
   acceptance pending; watch the startup hitch (whole LOD ring loads at once — phase-7 load budget) and tune
   `Config.streaming`.

   **(Decided: removed the static path entirely — streaming is the only render path.)** — Register the
   StreamingSystem in the bootstrap with a player-`Transform` view provider;
   `loadGame` seeds the view + starts streaming. **Remove the static path:** delete `WorldAdapter.loadRegion`
   + its adapter impl, `buildRegion` + `RegionOptions`, and `Game`'s `worldObjects`/`loadRegion` logic. **Keep**
   `addToGroup`/`buildInstancedMeshes` (used by `buildCell`), `RegionMeshData` (picking `userData.region`), and
   `RegionRequest` (still used by `loadColliders`/`loadCollisionDebug`). `Game.setManualCells` passthrough.
   Debug overlay: drop the `geometry: lods|map` + `camera: ganton|full-map` toggles; entering debug → manual
   mode seeded with the current cell + an **N×N checkbox grid** of nearby cells (tick extra sections to view) +
   a **"Show LODs"** toggle; leaving debug → resume streaming. **Acceptance (browser):** drive around — HD
   around you, LODs ringing out, cells stream as you move; Ctrl+D → inspect/compare sections + LODs; close →
   streaming resumes. (Draw distances + cell size stay `Config.streaming`, live-tunable via `setConfig`.)
7. **Refinements (optional) — DEFERRED.** Not needed yet (no lag in-browser at the current scale, per the
   user). When wanted: per-instance `drawDistance` culling inside HD cells; precise HD↔LOD swap via the `lod`
   link index; hysteresis on cell load/unload; per-frame cell-build budget; LRU eviction of the adapter cache.

## Testing

- **Pure (vitest, node):** `buildWorldGrid` bucketing + HD/LOD split + cell keys; `cellsWithin` ring math;
  `buildCell` instanced parts from a stub grid; StreamingSystem load/unload diff with a stub adapter (no DOM).
- **Browser acceptance** for the visual streaming/LOD rings + tuning (imperative renderer; manual/Playwright).
- Keep the boundary lint green (`game/**` may not import renderware except adapters).

## Decisions / open questions

- **Grid vs pure per-instance drawDist.** Recommend **grid streaming** (cheap whole-cell load/unload) over
  per-frame per-instance culling (would rebuild 36k-instance meshes each frame). Per-instance `drawDist` is a
  refinement *inside* HD cells (phase 7).
- **Cell size + distances.** Start `cellSize 250`, `hdDrawDistance 300`, `lodDrawDistance 1500`
  (SA-ish); expose for tuning. Revisit after seeing it in-browser.
- **One streaming root vs per-cell −90°X.** Recommend **one streaming root** (−90°X) owning all cells; cells
  added without their own rotation (less duplication than per-cell groups).
- **HD ring also draws LODs?** Recommend **no** (HD ring = HD only, LOD ring = LOD only) — matches SA (LOD
  hidden when HD loaded) and halves draw work. Precise per-object swap via `lod` index is phase 7.
- **Throttle.** Re-evaluate the cell set only when the view enters a new cell (+ a small hysteresis), not
  every frame.

## Out of scope (later / their own work)

- **Collision streaming** (load COL per HD cell on the same grid) — pairs naturally with this but is a
  follow-up; for now collision stays the fixed area around spawn (plan 008).
- Occlusion culling, interiors streaming, time-of-day model swaps (`tobj`),
  texture streaming (we hold everything in memory), and swapping the cube for a real DFF character (separate).

## Follow-up (done): runtime draw-distance controls

The "draw-distance slider scaling" item above is implemented. `Game.setStreaming(patch)` merges into
`config.streaming`; `StreamingSystem` and `CollisionStreamingSystem` already read the config **live**
each frame, so changes apply next frame (new cells stream in, surplus stream out) with no reload.
Debug **Map** screen (`DrawDistanceControls`, plan 023): **Draw Distance** (`lodDrawDistance`) and
**HD Distance** (`hdDrawDistance`) sliders (HD clamped ≤ LOD). The Draw Distance slider also drives the
fog so the LOD cull edge stays hidden (`fog ≈ lod × 0.8` — see plan 024). Camera far stays 100000.

## Follow-up (done): seamless LOD↔HD swap + hysteresis

Fixed the LOD→HD "blink" (model vanished, then faded back in). Root cause: `update()` removed the old
level immediately, then loaded the new level **async** and faded it from `opacity 0` — so the cell was
empty for ≥1 frame (gap) and then ghosted in. Fix in `streaming.system.ts`:

- **Defer removal:** a cell's old detail level is kept rendering until its same-`(cx,cy)` replacement
  has loaded and been added. The removal loop skips a left-behind level while its replacement is in
  `loading`; the load handler adds the new level (full opacity) FIRST, then removes the old in the
  same step → no empty frame.
- **No fade on a swap:** the new level appears at full opacity (silhouette already on screen from the
  old level). `CellFader` now runs only for genuinely new cells (first appearance), never on LOD↔HD.
- **Hysteresis dead-band** (`HYSTERESIS = 0.25 × cellSize`): a cell holds its current level until the
  view moves a margin past the ring boundary (sticky on what's loaded/loading) — no flip-flop when
  straddling `hdDrawDistance`. (Implements the "throttle/hysteresis" decision noted above.)
  `grid.ts` exports `cellDistanceSq` for the per-cell distance the dead-band needs.

Tests: `streaming.system.test.ts` — LOD held until HD loads then swaps (no empty frame); dead-band
holds the level across the boundary.
