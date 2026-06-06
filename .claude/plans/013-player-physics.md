# 013 — Player physics: kinematic capsule character controller

## Goal

Replace the player's **dynamic box + `setLinvel`** body with a Rapier **`KinematicCharacterController`
+ capsule collider**, fixing the issues the box causes and adding movement feel:

1. **Proper collision shape** — a vertical **capsule** (rounded) instead of a box, so the player slides
   around poles/corners instead of welding into them and no longer gets stuck.
2. **Run inertia** — accelerate up to speed (not instant), keep momentum when changing direction, and carry
   horizontal momentum into jumps (jumping mid-run isn't an instant stop/teleport).
3. **Steps / small obstacles** — auto-step over kerbs, stairs, low ledges.
4. **Slide, don't stick** — glide along obstacles (built into the controller); should also remove the
   "welded into a pole" behaviour.
5. **Slopes** — walk up/down ramps within a max angle, stay glued to the ground (no launching off slopes,
   no floating down stairs).

## Current state

- `PhysicsWorld.createCharacterBody` = a **dynamic** cuboid, `lockRotations()`, friction 1.
- `CharacterControllerSystem.fixedUpdate` sets the body's **linear velocity directly** (`setLinvel`) from
  camera-relative input; jump sets `vz`; steering only while grounded (`isGrounded` = a downward ray).
- `PhysicsSystem.fixedUpdate` steps the world and copies each body's transform → ECS `Transform`.
- `CharacterAnimationSystem` reads speed/grounded via `physics.getLinvel` + `physics.isGrounded`.
- Map collision streams as **fixed** trimesh/box/sphere bodies (plan 010) — unchanged; the controller
  queries them.

## Research

- **GTA SA peds:** the per-bone **sphere (head) + capsules/boxes** are the **hit/ragdoll** collision
  (bullets, melee, falling), not movement. **Movement uses a capsule-like swept shape.** So the movement
  collider here should be a single **vertical capsule**; the multi-shape hitbox is a separate later task
  (shooting/ragdoll), out of scope.
- **Rapier 0.19 has the full kinematic character controller** (verified in `@dimforge/rapier3d-compat`):
  `world.createCharacterController(offset)`, `enableAutostep(maxHeight, minWidth, includeDynamic)`,
  `enableSnapToGround(distance)`, `setMaxSlopeClimbAngle(rad)` / `setMinSlopeSlideAngle(rad)`,
  `computeColliderMovement(collider, desiredDelta, …)` → `computedMovement()` (slid/corrected) +
  `computedGrounded()`. Body = `RigidBodyDesc.kinematicPositionBased()`, advanced with
  `setNextKinematicTranslation(pos + computedMovement)` before `world.step()`.
- **Capsule axis:** `ColliderDesc.capsule(halfHeight, radius)` is **Y-aligned** in Rapier's local frame; our
  world is **Z-up**, so the collider needs a +90°-about-X rotation (Y→Z) to stand vertical.

## Design

A kinematic, position-based player whose movement we integrate ourselves and correct via the controller:

- **Body/shape:** `kinematicPositionBased` body + a Z-aligned **capsule** (radius ≈ 0.3, half-height of the
  cylinder so total height ≈ the character ≈ 1.8). Kinematic bodies ignore world gravity → we integrate it.
- **Velocity (ECS):** a new `Velocity {x,y,z}` (+ a `grounded` flag) the controller owns. Each fixed step:
  - **Horizontal:** accelerate the current horizontal velocity toward the camera-relative input target
    (`walk`/`run` speed) at an **accel** rate; **decelerate** toward 0 with no input; reduced control in the
    air (**airControl**). This gives ramp-up, momentum, and turn-with-inertia.
  - **Vertical:** `vz -= g·dt`; on **jump** while grounded set `vz = jumpSpeed`; when grounded clamp `vz`.
  - `desired = velocity · dt` → `controller.computeColliderMovement(capsule, desired)` →
    `corrected = computedMovement()`, `grounded = computedGrounded()`.
  - `body.setNextKinematicTranslation(pos + corrected)`; write `grounded` + (optionally corrected-derived)
    velocity back to ECS. On grounded, reset downward `vz`.
- **Controller config:** `enableAutostep(stepHeight≈0.4, minWidth≈0.1, true)`, `enableSnapToGround(≈0.4)`,
  `setMaxSlopeClimbAngle(≈50°)`, `setMinSlopeSlideAngle(≈45°)`, controller `offset ≈ 0.02`.
- **Animation/camera:** `CharacterAnimationSystem` reads the ECS `Velocity` (planar speed) + `grounded`
  instead of `physics.getLinvel`/`isGrounded`; facing/state machine unchanged. Camera unchanged (follows the
  body's `Transform`).

## Module touch list

```
src/game/physics/physics-world.ts   # createCharacterController; createKinematicCapsule (Z-aligned);
                                     #   moveCharacter(controller, body, collider, desired) -> {movement, grounded};
                                     #   expose collider handle; keep dynamic/static helpers
src/game/ecs/components.ts          # + Velocity {x,y,z} (+ grounded flag)
src/game/character/character-controller.system.ts  # velocity integration (accel/decel/air/gravity/jump) +
                                                    #   computeColliderMovement + setNextKinematicTranslation
src/game/character/character-animation.system.ts   # read Velocity + grounded from ECS
src/game/character/setup-character.ts              # kinematic capsule + controller; expose handles
src/game/interfaces/config.interface.ts            # MovementConfig += accel, deceleration, airControl
                                                    #   (+ optional capsule/step/slope params or constants)
src/ui/canvas-host.tsx                             # config values
```

## Iterations (each keeps `npm test` + the app green)

1. ✅ **PhysicsWorld: capsule + character controller plumbing — DONE.** `createCharacterController(offset=0.02)`
   — **`setUp({0,0,1})`** (critical: Z-up; Rapier defaults to Y-up), slide, `enableAutostep(0.4,0.1,true)`,
   `enableSnapToGround(0.4)`, `setMaxSlopeClimbAngle(50°)`, `setMinSlopeSlideAngle(45°)`,
   `setApplyImpulsesToDynamicBodies(true)`. `createKinematicCapsule(pos, radius, halfHeight)` → kinematic
   body + **Z-aligned capsule** (Rapier capsule is Y-aligned → collider rotation +90°X, `CAPSULE_UPRIGHT`);
   returns `{ body, collider }` handles. `moveCharacter(controller, body, collider, desired)
   → { grounded, movement }` (computeColliderMovement → computedMovement/Grounded → setNextKinematicTranslation).
   Existing dynamic/static helpers kept. 2 new tests (capsule lands on ground + reports grounded; slides along
   a wall without penetrating). 195 tests + tsc + eslint + build clean. No wire-in → no behaviour change.

2. ✅ **Wire the player to the kinematic capsule (no inertia yet) — DONE (code; browser pending).** New ECS
   `Velocity {x,y,z,grounded}`; `RigidBody` gained a `collider` handle. `setup-character` builds the
   kinematic capsule (radius = planar half-extent ≈0.3, halfHeight = `extents[2]−radius` ≈0.6 → total ≈1.8)
   + the controller, sets `RigidBody.handle/collider`, adds `Velocity`. `CharacterControllerSystem` rewritten:
   horizontal velocity = camera-relative input target (still instant), `vz` = reset-on-ground + jump impulse
   + gravity integration, → `physics.moveCharacter(controller, body, collider, velocity·step)` → writes
   `Velocity` + `grounded`. `CharacterAnimationSystem` now reads the ECS `Velocity`/`grounded` (ctor
   `(animController, playerEid, character, config)`). `PhysicsSystem` unchanged (steps; kinematic body moved
   by the queued translation → `readBody` → `Transform`). Controller test rewritten for the kinematic/ECS
   path (steps to build the query pipeline). 195 tests + tsc + eslint + build clean. **Browser acceptance ✅
   — player slides through/around obstacles, never gets stuck.**

3. ✅ **Run inertia — DONE (code; browser pending).** `MovementConfig` += `accel`/`deceleration`/`airControl`.
   The controller `approach`es the horizontal velocity toward the input target by `(moving ? accel :
   deceleration) · (grounded ? 1 : airControl) · step` (one vector lerp-toward handles ramp-up, decel toward
   rest, and turn momentum); vertical unchanged, so horizontal momentum carries into jumps with reduced air
   control. Defaults `accel 20, deceleration 25, airControl 0.3` (+ existing walk 3 / run 7 / jump 3.5).
   Controller tests updated (ramps but not instant; reaches target after sustained input; decelerates on
   release). 196 tests + tsc + eslint + build clean. **Browser acceptance ✅ — ramps up, turns curve, momentum
   into jumps.**

4. ✅ **Tune + polish — DONE (browser ✅).** Final feel tuning, all browser-confirmed:
   - **Foot-slide fix:** `AnimationController.setSpeed` scales the walk/run clip playback to the actual ground
     speed (`speed / authored`, authored walk 1.52 / run 4.31 u/s from the IFP root motion; clamp 0.6–2.2) so
     the feet stop sliding.
   - **Smooth turn:** `CharacterAnimationSystem` eases `facing` toward the movement direction at `TURN_SPEED`
     (12 rad/s) instead of snapping — visible turn when the camera is rotated then you move.
   - **Procedural bounce:** a small vertical body bob on the inner model (`applyBounce`), phase by distance
     (`BOB_FREQUENCY 7` ≈ 2 bobs/stride, footfall-synced), amplitude `BOB_AMPLITUDE 0.007` ramped to walk
     speed and **held** (run doesn't amplify — fixed the "shakes at run").
   - **Final speeds:** `walkSpeed 2, runSpeed 7, jumpSpeed 3.5, accel 20, deceleration 25, airControl 0.3`.

**Plan 013 COMPLETE (iters 1–4).** The player is a kinematic capsule + Rapier character controller: slides
around obstacles (never stuck), autosteps kerbs/stairs, handles slopes with snap-to-ground, has run inertia
(ramp/decel/turn-momentum/air-control), speed-matched feet, a smooth movement turn, and a gentle locomotion
bounce. All movement tunables live in `Config.movement`.

## Decisions / open questions

- **Kinematic vs dynamic:** kinematic position-based + controller — the standard for responsive, non-sticky
  character movement; we own velocity so inertia is explicit and tunable. (Dynamic + forces fights the
  designer; the box's sticking is inherent.)
- **Single capsule vs multi-shape:** single vertical capsule for movement now; the GTA head-sphere + limb
  capsules/boxes are hit/ragdoll collision — a later task.
- **Velocity source for animation:** kinematic bodies report no `linvel`, so the animation/state machine must
  read the ECS `Velocity` + the controller's `grounded` (replaces `physics.getLinvel`/`isGrounded`).
- **Gravity:** integrated manually into `vz` (kinematic bodies ignore world gravity); world gravity still
  applies to any dynamic bodies.
- **Slope snapping** keeps the player glued going downhill/downstairs (no float); **max slope** stops walking
  up walls; tune both.

## Out of scope (later)

Multi-shape ped hitbox (sphere head + limb capsules/boxes) for shooting/ragdoll, swimming/climbing/cover,
pushing dynamic objects, moving platforms, NPC controllers, and crouch/prone capsule resizing.
