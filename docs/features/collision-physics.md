# Collision + physics

`packages/renderware/src/parsers/binary/col.ts`, `packages/renderware/src/collision/`,
`packages/game/src/physics/`, `packages/game/src/streaming/collision-streaming.system.ts`.

## Implemented

- COL library parsing (versions 2/3; v1 skipped): bounds, spheres, boxes, faces with **surface
  material ids** (= surfinfo row index) + light byte, compressed vertices.
- DFF-embedded collision (`parseDffCollision`) for vehicles.
- `CollisionIndex`: every `.col` library in the archive flattened to name → model
  (WeakMap-cached per archive; parse failures skip the library).
- `bindColliders`/`buildCellColliders`: per-cell collider sets with world transforms (same IPL
  conjugate-quaternion convention as rendering); exterior + non-LOD only.
- Physics (Rapier): static trimesh/box/sphere creation per cell via
  `CollisionStreamingSystem` (radius `collisionDrawDistance`, diff-based load/unload, `reload()`
  for live invalidation); character capsule/box controller; vehicle chassis convex hull +
  raycast wheels; vehicle damage system.
- **Clutter collision** (procobj): models that ship a COL collide; the collidable subset always
  equals the rendered subset (density knobs + `procObjLimit` lottery cap), live re-stream on
  knob changes (debounced cache invalidation).
- Collision debug wireframe overlay (map-viewer).

## Known gaps / candidates

- COL v1 unsupported (none shipped in our data).
- Face surface materials are used by procobj only — no per-surface friction/sounds yet
  (`surface.dat` adhesion + `surfaud.dat` audio are future phases).
- No moving/animated colliders (the IFP-animated map objects don't collide with their moving
  parts).

## Test coverage anchors

`col` parser tests, `collision-index/build-colliders/build-cell-colliders` tests,
`collision-streaming.system.test.ts` (incl. reload), `procobj-colliders.test.ts`, adapter
collider cache tests.
