# 010 — Collision streaming (static COL on the render grid)

## Goal

Stream the **static map collision per grid cell** (the same grid the renderer streams on, plan 009) around
the player, instead of building one fixed zone around the spawn. Cells gain Rapier static colliders as the
player approaches and drop them when far, so collision works everywhere the player drives — not just near
spawn — without holding the whole map's collision in the physics world.

## Current state (fixed zone)

- `Game.loadColliders()` → `adapter.loadColliders(lastRequest{center, radius})` → `buildColliders(index, defs,
  {center, radius})` → `ModelColliders[]` → `CollisionWorld`.
- `setupCharacter` builds it **once**: `await game.loadColliders(); physics.createStaticColliders(world.models)`
  → fixed Rapier bodies for the Ganton zone (radius 400). Drive past it → no ground.
- `PhysicsWorld.createStaticColliders(models)` → returns a **count** (no handles, so nothing can be removed).
- The COL pipeline (plan 007): `buildCollisionIndex(archive)` (name → `ColModel`), `buildColliders` (bind by
  name, conjugated-quat transforms, Z-up), `toModelColliders` (adapter: `RegionColliders` → engine DTO).

## Design (reuse 007/008/009 pieces)

Mirror the render streaming, but the "load" creates Rapier bodies and the "unload" removes them. Collision is
needed only where the player physically is, so it streams on a **small radius** (a few cells), independent of
the bigger render HD/LOD rings.

1. **Per-cell collider build (renderware).** Factor the bind step out of `buildColliders`; add
   `buildCellColliders(index, defs, grid, cx, cy)` → `RegionColliders[]` for that cell's **HD** instances
   (LODs have no collision). Reuses the `WorldGrid` already built in the adapter for rendering.
2. **Adapter cell seam.** `WorldAdapter.loadCellColliders(cx, cy): Promise<ModelColliders[]>` (cell HD →
   `buildCellColliders` → `toModelColliders`), cached by cell — like `loadCell` for rendering.
3. **PhysicsWorld: removable bodies.** `createStaticColliders(models)` returns the created **body handles**
   (`number[]`) instead of a count; add `removeBodies(handles)` (`world.removeRigidBody` frees the body + its
   colliders). The character-body / temp helpers are unaffected.
4. **CollisionStreamingSystem (game).** `game/streaming/collision-streaming.system.ts` (a `System`): each
   `update`, view cell → desired collision cells = HD cells within `collisionDrawDistance` (via `cellsWithin`)
   → diff a `Map<cellKey, handles[]>`; for new cells `loadCellColliders` → `createStaticColliders` (track
   handles), for gone cells `removeBodies`. Async load with a margin radius so colliders are ready a cell
   *before* the player arrives (no fall-through at boundaries).
5. **Config.** `Config.streaming.collisionDrawDistance` (small — e.g. ~150; just around the player + a margin).
6. **Wire-in.** `setupCharacter` registers the `CollisionStreamingSystem` (with the player `viewOf`, the
   `PhysicsWorld`, the adapter, config) instead of the one-shot `createStaticColliders`. Remove the fixed
   `Game.loadColliders` / `CollisionWorld` collider path (superseded — like the render static path in 009).

Coordinates stay GTA **Z-up** (physics convention from 008); no change to the −90°X display rule.

## Module touch list

```
src/renderware/collision/
  build-colliders.ts   # + bindColliders(index, groups) factored out; buildColliders reuses it
  build-cell-colliders.ts  # buildCellColliders(index, defs, grid, cx, cy) -> RegionColliders[]
src/game/physics/
  physics-world.ts     # createStaticColliders -> number[] (handles); + removeBodies(handles)
src/game/streaming/
  collision-streaming.system.ts  # CollisionStreamingSystem (diff cells -> create/remove Rapier bodies)
src/game/interfaces/world-adapter.interface.ts  # + loadCellColliders(cx,cy)
src/game/adapters/gta-sa-world.adapter.ts        # implement loadCellColliders (cached)
src/game/interfaces/config.interface.ts          # + StreamingConfig.collisionDrawDistance
src/game/character/setup-character.ts            # register the system; drop the one-shot collider build
```

## Iterations (each keeps `npm test` + the app green)

1. ✅ **Per-cell colliders — DONE.** Factored `groupInstanceByModel` + `bindColliders` out of `buildColliders`
   (reuses them; behaviour unchanged). `renderware/collision/build-cell-colliders.ts` —
   `buildCellColliders(index, defs, grid, cx, cy)` → `RegionColliders[]` for the cell's HD instances (`[]` if
   the cell isn't in the grid). 4 unit tests (missing cell → []; HD with no collision skipped; LOD ignored; HD
   bound with one transform per placement); 168 total green; tsc + eslint clean. No behaviour change.
2. ✅ **PhysicsWorld handles + remove — DONE.** `createStaticColliders` returns body **handles** (`number[]`,
   one body per placement; empty-shape placements create none); new `removeBodies(handles)`
   (`world.removeRigidBody`). Tests updated to handle counts + a new `removeBodies` test (ground collider →
   box rests at z≈1 → remove → falls through). 168 total green; tsc + eslint + build clean. (setupCharacter
   still builds the fixed zone and ignores the return — replaced in iteration 5.)
3. ✅ **Adapter `loadCellColliders` — DONE.** `WorldAdapter.loadCellColliders(cx, cy): Promise<ModelColliders[]>`;
   `GtaSaWorldAdapter` impl = `buildCollisionIndex` + `buildCellColliders` → `toModelColliders`, cached by cell
   (`colliderCache`). 2 unit tests via the existing `vi.mock` stub (throws before prepare; caches — same array
   on repeat). 170 total green; tsc + eslint + build clean. No behaviour change (unused yet).
4. ✅ **CollisionStreamingSystem — DONE.** `game/streaming/collision-streaming.system.ts` — each `update`:
   view cell → desired cells within `collisionDrawDistance` (`cellsWithin`) → diff `Map<cellKey, handles>` →
   async `loadCellColliders` + `createStaticColliders` (track handles) for new, `removeBodies` for gone;
   guards double-load + add-if-still-current. `Config.streaming.collisionDrawDistance` (default 150). 2 unit
   tests (stub physics + adapter, no Rapier: loads cells in radius; view-move → removeBodies old + load new).
   172 total green; tsc + eslint + build clean. Not wired yet (iteration 5).
5. ✅ **Wire-in + acceptance — DONE (browser ✅ confirmed — cube drives on the ground everywhere).** Bootstrap registers
   `CollisionStreamingSystem(adapter, ctx.physics, ctx.viewOf, config)`; `setupCharacter` drops the one-shot
   `loadColliders`/`createStaticColliders`. **Removed the fixed-zone path:** `Game.loadColliders`/
   `getCollisionWorld`/`collisionWorld`, `CollisionWorld` class + test + barrel export, `WorldAdapter.loadColliders`
   + impl. Kept `buildColliders`/`loadCollisionDebug` (Show Collision) + `toModelColliders` (cell colliders).
   167 tests green; tsc + eslint + build clean. **Acceptance (browser):** drive far from spawn — cube lands on
   the ground everywhere; collision streams with the player. (Show Collision wireframe stays region-based at
   spawn — known limitation.)

## Decisions / open questions

- **Separate system vs extend the render `StreamingSystem`** — recommend a **separate
  `CollisionStreamingSystem`** (different payload = Rapier bodies, different radius); they share the grid math
  + view but not the load/unload action.
- **Collision radius** — separate `collisionDrawDistance` (~150, small + margin), not tied to the HD render
  ring (which is bigger). Tune in-browser.
- **Run on `update` vs `fixedUpdate`** — `update` (per frame), with the margin radius so colliders exist
  before the player reaches a new cell (async load tolerated). No need to gate on play/pause (loading is
  cheap; physics only steps in play anyway).
- **`Show Collision` debug overlay** — stays region-based (a fixed wireframe of the area) for now; it may show
  more than the active streamed bodies. Streaming the debug wireframe too is a later nicety.
- **`CollisionWorld` / `Game.loadColliders`** — superseded by the streaming system; remove (or leave dormant).
  Recommend remove for clarity, mirroring the render static-path removal in 009.

## Out of scope (later)

LRU/budget for collision cell builds (not needed at this scale, like render streaming), streaming the Show
Collision wireframe, collision for LODs/interiors, dynamic-object collision, and the DFF character swap.
