# Vehicles

`packages/renderware/src/three/build-vehicle.ts`, `packages/game/src/vehicle/`, vehicle-reflection plugin,
plans 015–021/025/030/033.

## Implemented

- **Loading**: vehicles.ide defs, DFF with frame hierarchy KEPT (doors/wheels as named parts),
  embedded COL, generic `vehicle.txd` merge, per-model TXD. Both SA wheel conventions are built:
  a single shared `wheel` atomic instanced at the `wheel_*_dummy` frames (scaled per front/rear,
  mirrored on the right), or per-corner `wheel_{l|r}{f|m|b}` atomics placed at their own frames
  (different front/rear wheels). Both handle the middle axle (`m`) of 3-axle trucks, and per-corner
  wheels take precedence over a stray shared `wheel` atomic some exporters leave in. A lone corner
  atomic with no shared `wheel` but real `wheel_*_dummy` frames (a mis-named shared wheel some mods
  ship, e.g. comet with only `wheel_rf`) is treated as the shared wheel and instanced at all dummies,
  so it renders four wheels instead of one. A third, wheel-mod convention is also handled: an
  `f_wheel_<mask>` container frame (e.g. `f_wheel_1111`, cheetah) whose child atomics are the wheel
  sub-model — its geometry is instanced at every dummy instead of rendered once as body.
- **Paint**: carcols.dat palettes; SA editable-material markers — primary (60,255,0), secondary
  (255,0,175), tertiary (255,175,0), quaternary (255,60,0); colour spec strings `"p,s[,t,q]"`
  with omitted 3rd/4th defaulting to palette 0 (SA behaviour); RW modulate (texture × material
  colour) for non-marker textured materials (dark interiors fix).
- **Reflections** (plan 030): MatFX env coefficient + SA reflection/specular plugin data carried
  per material; preset-driven plugin (`off`/SA sphere-map/`enhanced` clearcoat via
  MeshPhysicalMaterial), live intensity/preset switching, sky probe refresh on weather change.
- **Glass** (plan 025): window materials detected and rendered transparent (double-sided,
  sorted).
- **Extras** (`extraN` components): SA's mutually-exclusive optional parts modelled at the same spot (e.g. the
  Benson's swappable advertising boards). The builder shows **at most one** per spawn — a random `extraN` (via
  `VehicleOptions.rng`, default `Math.random`), hiding the rest. Without this, all `extraN` atomics render on top
  of each other (overlapping jumble).
- **Physics** (plans 017/018): Rapier dynamic chassis from the COL convex hull, raycast wheels
  (suspension), handling.cfg parsed (kept for tuning), enter/exit flow with seat alignment
  (plan 016) — the run-to-door is interruptible (movement input or a blocked path hands control back,
  GTA-style), damage system (plan 019) using the full COL.
- **LOD/streaming** (plan 021): HD/LOD/unload distances per vehicle, placements respawn.
- **Headlights** (plan 033, ⚠️ MVP — redo later): glowing lamp glass + coronas at the lamp dummies; lamps
  found by position near the `headlights`/`taillights` dummies; no road beam yet. See night-and-time.md.
- Spawn tooling: debug Vehicles screen lists **every** car from `vehicles.ide` (sorted, with a name filter);
  parked placements at Ganton. The list comes from `vehicleModelsFromIde` (apps/web) — no hardcoded car set.
- Mods: a vehicle's model/texture/data can be overridden at runtime by dropping files under `modloader/` — no
  rebuild. The loader reads each model/txd by its **bare** name (from gta3.img, or shadowed by the overlay), so
  there's no loose `vehicles/` folder. See [mods.md](mods.md).

## Known gaps / candidates

- Headlights proper redo (road beam projected onto the asphalt; per-lamp brake/indicator/reverse) — MVP has none.
- No NPC traffic (headlight gating already generalizes via `seated`).
- Damage is collision-driven deformation state, not visual mesh swaps for every panel.
- No vehicle audio.
- **LEFTOVER — extras = "exactly one"**: the current `extraN` handling shows exactly one of the mutually-exclusive
  components, which covers the Benson (ad boards) and similar variant sets. SA's real rule is more nuanced — **two
  independent slots** chosen by the `carcols` component rules, each able to resolve to "nothing". If a vehicle ever
  needs **two simultaneous** extras (or a chance of **none**), that's a follow-up built on top of the same
  `hiddenExtraFrames` helper (it would need the carcols comp rules, which we don't parse yet).

## Test coverage anchors

`build-vehicle.test.ts` (markers, modulate, parts, extras — synthetic + real petro-6wheels.dff), vehicle systems
tests (physics/lod/damage), adapter vehicle data tests.
