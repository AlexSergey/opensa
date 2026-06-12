# Vehicles

`src/renderware/three/build-vehicle.ts`, `src/game/vehicle/`, vehicle-reflection plugin,
plans 015–021/025/030/033.

## Implemented

- **Loading**: vehicles.ide defs, DFF with frame hierarchy KEPT (doors/wheels as named parts),
  embedded COL, generic `vehicle.txd` merge, per-model TXD.
- **Paint**: carcols.dat palettes; SA editable-material markers — primary (60,255,0), secondary
  (255,0,175), tertiary (255,175,0), quaternary (255,60,0); colour spec strings `"p,s[,t,q]"`
  with omitted 3rd/4th defaulting to palette 0 (SA behaviour); RW modulate (texture × material
  colour) for non-marker textured materials (dark interiors fix).
- **Reflections** (plan 030): MatFX env coefficient + SA reflection/specular plugin data carried
  per material; preset-driven plugin (`off`/SA sphere-map/`enhanced` clearcoat via
  MeshPhysicalMaterial), live intensity/preset switching, sky probe refresh on weather change.
- **Glass** (plan 025): window materials detected and rendered transparent (double-sided,
  sorted).
- **Physics** (plans 017/018): Rapier dynamic chassis from the COL convex hull, raycast wheels
  (suspension), handling.cfg parsed (kept for tuning), enter/exit flow with seat alignment
  (plan 016), damage system (plan 019) using the full COL.
- **LOD/streaming** (plan 021): HD/LOD/unload distances per vehicle, placements respawn.
- **Headlights v1** (plan 033): see night-and-time.md.
- Spawn tooling: debug Vehicles screen (admiral/camper), parked placements at Ganton.

## Known gaps / candidates

- Headlights v2 (2dfx vehicle lights) pending.
- No NPC traffic (headlight gating already generalizes via `seated`).
- Damage is collision-driven deformation state, not visual mesh swaps for every panel.
- No vehicle audio.

## Test coverage anchors

`build-vehicle.test.ts` (markers, modulate, parts), vehicle systems tests (physics/lod/damage),
adapter vehicle data tests.
