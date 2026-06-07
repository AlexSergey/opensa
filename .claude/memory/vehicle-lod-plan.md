---
name: vehicle-lod-plan
description: Plan 021 (DONE) — vehicle distance LOD (_vlo) + cull + memory unload/respawn
metadata:
  type: project
---

Plan 021 (`.claude/plans/021-vehicle-lod.md`), DONE — finishes the vehicles with GTA-style distance LOD.

- `build-vehicle.ts`: `*_vlo` atomics (were skipped) now go into a hidden `lod` Group under `root`;
  `BuiltVehicle.lod` / `VehicleModel.lod` expose it (null if the model has no vlo).
- `Config.vehicle: VehicleConfig` thresholds (world units from the player view): `hdDistance` (full
  HD), `lodDistance` (show `_vlo` between hd and this; beyond = culled), `unloadDistance` (despawn from
  memory; respawn when back within `lodDistance` — hysteresis band in between). Set in canvas-host
  (80 / 250 / 500). Tunable.
- `VehicleLodSystem` (`src/game/vehicle/vehicle-lod.system.ts`): per `update`, measures distance from
  `viewOf()` and toggles HD children vs `lod` vs object.visible=false; unloads/respawns via callbacks.
  A near (enter/drive-range) car is always HD, so the player's own car never degrades or unloads.
- canvas-host has a `spawnVehicle(placement)` factory (registers with the 3 vehicle systems, returns
  `despawn`). `remove()` exists on `VehiclePhysicsSystem`/`EnterVehicleSystem`(no-op on active car)/
  `VehicleDamageSystem`. Despawn = `physics.removeBodies` + `disposeVehicle` (materials/geometry only;
  generic vehicle textures are SHARED — never dispose them) + remove from streamingRoot.

Notes: respawn resets a parked car's damage (GTA despawns distant cars too); respawn re-fetches the
DFF/TXD (small) — caching the built model is a possible later optimisation. Related:
[[vehicle-physics-plan]], [[diagnostics-logging]].

**Despawn gotcha (fixed):** a raycast vehicle's `VehicleController` must be removed via
`PhysicsWorld.removeVehicle(controller)` BEFORE `removeBodies([body])` — otherwise `step()`'s
`updateVehicle` runs on the orphaned controller and Rapier panics (`unreachable`). The `despawn` closure
does this; same applies to any future vehicle teardown.
