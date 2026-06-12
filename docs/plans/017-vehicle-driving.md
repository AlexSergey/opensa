# 017 — Vehicle driving (arcade kinematic)

## Goal

Drive the car you're seated in: WSAD = throttle/brake + steer; the car moves, the wheels spin and the
front pair steers, the player rides in the seat and turns with the car, the camera chases from behind.
Builds on [[enter-vehicle-plan]] (seated state) + [[vehicle-loading-plan]] (`VehicleRig` wheels) +
the parsed `handling.cfg` dict.

## Approach

**Kinematic arcade** first (not full Rapier vehicle physics): integrate a scalar `speed` + `heading` from
input each frame and move the car transform. Collision and handling.cfg-accurate feel come in later
iterations. The car visual is the static `object` under the −90°X streaming root; we mutate its
`position` + `rotation.z` (native Z-up). The seated player capsule is teleported to the moving seat each
frame (as already done when seated). Wheels via `VehicleRig.setSpeed/ setSteer`.

## What we have

- Seated state machine (`EnterVehicleSystem`, phase `seated`): player gated, `CAR_sit` looping, body teleported
  to the seat, camera behind the rear.
- `VehicleRig` (`setSpeed`, `setSteer`) + `VehicleSystem` already spin/steer wheels.
- `handling.cfg` parsed into a dict (raw fields) in the adapter (not yet interpreted).
- The car has a **static COL collider** at its parked spot (problem for driving — see iter 3).

## Iterations

1. **Kinematic drive core.** While `seated`, read WSAD (config.controls); integrate `speed`
   (accel/brake/drag, clamp fwd/reverse max) + `heading` (turn rate scaled by speed, inverted in reverse);
   move the car `object` (pos + yaw); keep a live `driveState {pos, heading, speed}`; teleport the player to
   the moving seat; `rig.setSpeed(speed)` + `rig.setSteer(steer·MAX_STEER)`; hold `CAR_sit` facing the live
   heading (re-`setScripted` each frame — `play` no-ops on same clip). **Exit uses the live transform** (so you
   get out where the car stopped, not the parked spot). Simple constants for accel/max/turn. **No car↔world
   collision yet** (drives through things). Camera trails the player (already behind on seat).

2. **handling.cfg feel.** Interpret the parsed dict per car: mass/drive-force → accel, brake decel, max
   velocity, steering/traction → turn rate. Replace iter-1 constants with per-vehicle values.

3. **Collision.** Car can't drive through buildings: drive a kinematic body / character-controller for the
   car (or move + sweep the COL), and **move/replace the parked static collider** so it isn't left behind as
   a ghost (also fixes exit-into-old-collider).

4. **Polish.** Handbrake, reverse, can't exit above a speed, wheel steer easing/limits, body lean/suspension,
   engine idle/rev, brake lights, camera tuning.

## Module touch list (iter 1)

```
src/game/vehicle/enter-vehicle.system.ts   # drive() in the seated phase; driveState; exit uses live transform
src/game/character/character-animation.system.ts  # (already) setScripted facing update each frame
src/ui/canvas-host.tsx                      # EnterableVehicle += object, rig; pass config to the system
src/game/vehicle/enter-vehicle.system.ts   # EnterableVehicle += object: Object3D, rig: VehicleRig
```

## Decisions / open questions

- **Where driving lives:** folded into `EnterVehicleSystem` (it owns the seated state + has keyboard/physics/
  body/animation/camera). Needs `config.controls` (drive keys = walk keys) + the car `object`/`rig` on
  `EnterableVehicle`.
- **Live transform:** `driveState {pos, heading, speed}` from `startSeated`; seat + exit read it (the static
  `position`/`heading` are the parked placement, used only for approach/open before seating).
- **Collision deferred** to iter 3 — iter 1 drives freely (and the parked COL collider stays as a harmless
  ghost while seated; exit handled via live transform).
- **Steer/turn signs** tuned in-browser.

## Out of scope

Full Rapier raycast-vehicle physics, traffic/AI, passengers, gears/rpm audio, damage from collisions,
drive-by, multiple cars at once driving.
