# 016 — Player enters vehicle (driver seat)

## Goal

Press **Enter** near a car → CJ auto-runs to the driver door, opens it, climbs in behind the wheel.
Sequence with real animations + the door dummy swinging open + CJ ending in the seated/hands-on-wheel
pose. Driver side only (left front / LHS) for now; exit deferred.

## What we have (verified)

- **Animations in `ped.ifp`** (already loaded into the clip map by `loadAnimations`): `CAR_align_LHS`
  (approach/grab handle), `CAR_open_LHS` (open door), `CAR_getin_LHS` (climb in), `CAR_closedoor_LHS`
  (close from inside), `CAR_sit` (driver idle, hands on wheel). Also `CAR_getout_LHS`, `Drive_L/R` (later).
  These carry **root translation** (the ped moves relative to the car) → we need translation for getin or
  we move CJ manually; default `buildAnimationClip` strips translation.
- **Door**: `door_lf_ok` atomic, frame parent = `door_lf_dummy` (the hinge) at `[0,0,0]`; hinge sits at
  `[-1.05, 0.88, -0.02]` rel. body (left-front = driver). Door swings by rotating the hinge about **Z**.
- **Seat**: `ped_frontseat` dummy = sit target. (`ped_backseat`, `ped_arm` also present.)
- Wheel rig (`VehicleRig` + `VehicleSystem`) already exists; the dummy/pivot pattern is established.

## Design

### Component framework (extend `buildVehicle`)
- Wrap each `door_*_ok` atomic (frame parent is a `door_*_dummy`) in a **pivot at the hinge** so it can
  swing; skip `*_dam`. Expose on `BuiltVehicle`:
  - `doors: { side: 'lf'|'rf'|'lr'|'rr'; pivot: Group; closed: Quaternion }[]`
  - `seats: { frontseat: Matrix4; ... }` (local transforms) and the driver door **hinge local position**
    (for the align target).
- (Wheels already exposed; this generalises the rig to doors.)

### Vehicle registry (enterable vehicles)
- A small registry (held by the enter system) of placed vehicles: `{ root, rig, doors, seatLocal,
  doorEntryLocal }`. `findEnterable(playerPos, range)` → nearest car whose driver-door entry point is within
  range (a few metres). World transforms via `root.matrixWorld` (but vehicles live under the −90°X streaming
  root; the **physics/world** positions are native Z-up — compute entry/seat world points in native Z-up
  from the car's known placement, not the display matrix).

### Enter state machine (`EnterVehicleSystem`, game/vehicle)
Reads the Enter key (KeyboardInput). States:
1. `NONE` → on Enter, `findEnterable`; if found, lock onto it, **gate** the normal character controller +
   character-animation systems (CJ is now scripted).
2. `ALIGN` → drive CJ (reuse Velocity/locomotion or a simple move) to the door entry point, facing the car;
   walk/run anim. When close + aligned → `OPEN`.
3. `OPEN` → play `CAR_open_LHS` (one-shot) and swing the door pivot open (lerp hinge Z) over the clip.
4. `GETIN` → play `CAR_getin_LHS` (one-shot); lerp CJ from the door to the seat; near the end close the door
   (`CAR_closedoor_LHS` / lerp hinge back).
5. `SEATED` → parent CJ to the car at `ped_frontseat`; loop `CAR_sit`; controller stays gated. (Exit later.)

- **Controller gating**: add a `setEnabled(false)`/skip flag to the character controller + animation systems
  (or a shared player-state flag) so manual input + physics movement pause while scripted.
- **Camera**: keep the existing follow on CJ (now parented to the car) — revisit if it looks wrong.
- **Animations**: `CAR_*` clips are already in the controller's clip map; play via `AnimationController`
  (`play(name, fade, loop=false)` for one-shots, `CAR_sit` looping). Root translation: prefer manual CJ
  positioning (align→door→seat lerps) and play the clips in place; only enable clip translation if the
  in-place result reads wrong.

## Module touch list

```
src/renderware/three/build-vehicle.ts      # expose door pivots + seat/door-entry transforms (BuiltVehicle)
src/game/vehicle/vehicle-rig.ts            # (maybe) door open/close helper, or keep doors in the system
src/game/vehicle/enter-vehicle.system.ts   # NEW: the state machine
src/game/vehicle/vehicle.system.ts         # (rigs already updated here)
src/game/character/character-controller.system.ts   # gate flag while scripted
src/game/character/character-animation.system.ts    # gate flag while scripted
src/game/adapters/gta-sa-world.adapter.ts  # loadVehicle returns doors/seat too
src/game/interfaces/world-adapter.interface.ts      # VehicleModel += doors/seat
src/ui/canvas-host.tsx                      # register vehicles with the enter system; wire Enter key
```

## Iterations (each keeps tests + the app green)

1. **Door component** — `buildVehicle` wraps `door_*_ok` in hinge pivots; expose `doors` + `seatLocal` +
   `doorEntryLocal` on `BuiltVehicle`/`VehicleModel`. A door-open helper (rotate hinge about Z) + tests.
   Browser: nothing changes yet (doors closed).
2. **Registry + nearest query + Enter detection** — register placed vehicles; on Enter near a car, log/lock
   the target + open the driver door as a first visible step (no CJ move yet). Browser: door opens on Enter.
3. **Full sequence** — ALIGN → OPEN → GETIN → SEATED state machine; gate the player controller/anim; CJ runs
   to the door, plays align/open/getin, ends seated with `CAR_sit` (hands on wheel), door closes. Browser:
   the whole entry plays.
4. **Polish (optional)** — nearest-side (LHS/RHS), align tuning, exit (`CAR_getout_LHS`), camera framing.

## Decisions / open questions

- **Driver side only** (LHS / `door_lf`) now; multi-seat + RHS later.
- **No vehicle physics** — car stays static; CJ parents to it, sits. Driving comes later (`physic`).
- **Root motion**: manual CJ lerps + in-place clips first; switch to clip translation if needed.
- **Seat dummy** `ped_frontseat` is at `+X` on admiral2 (right-of-centre) — verify the seat side in browser;
  may need the left seat or an offset.

## Out of scope (later)

Exit/get-out, passenger seats, RHS, driving (steering/throttle from handling), traffic/AI, car-jacking,
camera rework, closing-door-from-outside.
