# 021 — Vehicle LOD (`_vlo`) + distance culling/unload

## Goal

Finish the vehicles with GTA-style distance LOD, driven by config thresholds:
- **Close** → full **HD** model (chassis + `_ok` panels + doors + wheels), as today.
- **Mid** → swap the HD body for the low-detail **`chassis_vlo`** mesh (cheap silhouette).
- **Far** → **cull** (hide) the car.
- **Very far** → **unload** it from memory (despawn the render object + physics body); respawn it
  when the view comes back within range.

The `_vlo` atomics are currently skipped in `build-vehicle.ts` — we now build them.

## Config (passed in from canvas-host)

New `Config.vehicle: VehicleConfig`:
- `hdDistance` — within this (world units, from the player view) → HD.
- `lodDistance` — between `hdDistance` and this → `_vlo`; beyond → culled.
- `unloadDistance` — beyond this → unloaded from memory; respawns when back within `lodDistance`
  (hysteresis: the gap `lodDistance..unloadDistance` is the culled-but-loaded band, so we don't
  thrash load/unload at one boundary).

Distance is measured from `viewOf()` (player position). While seated/driving the player rides the
car, so its distance ≈ 0 → always HD; an approaching/occupied car is always within HD range, so it
is **never** culled or unloaded (implicit safety — no explicit "busy" guard needed).

## Iterations

1. **Build the `_vlo` LOD mesh.** ✅ DONE — `build-vehicle.ts` collects every `*_vlo` atomic into a
   hidden `lod` Group under `root`; `BuiltVehicle.lod` exposed; threaded through `VehicleModel`
   (adapter) → canvas-host; `build-vehicle.test.ts` updated.
2. **Config thresholds + LOD swap/cull.** ✅ DONE — `VehicleConfig` added to `Config` (+ canvas-host
   + test fixtures); `VehicleLodSystem` toggles HD children vs `lod` vs culled per distance band.
3. **Unload / respawn from memory.** ✅ DONE — per-car spawn extracted into a `spawnVehicle`
   factory in canvas-host (returns a `despawn`); `remove()` added to `VehiclePhysicsSystem`,
   `EnterVehicleSystem` (no-op on the active car), `VehicleDamageSystem`; despawn uses
   `physics.removeBodies` + `disposeVehicle` (materials/geometry only — textures shared). The LOD
   system despawns past `unloadDistance` and respawns within `lodDistance` (async, guarded by a
   `loading` flag). Covered by `vehicle-lod.system.test.ts`.

## Notes / out of scope

- Unloading a damaged parked car resets its damage on respawn (GTA despawns distant cars too).
- Re-fetch on respawn is fine for now (vehicle DFF/TXD are small); caching the parsed/built model to
  avoid re-download is a later optimization.
- Per-vehicle LOD distances (vehicles.ide draw distance), traffic spawning, fade transitions.
