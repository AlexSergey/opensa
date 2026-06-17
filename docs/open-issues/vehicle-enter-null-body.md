# Crash on entering a freshly-spawned car (`readBody` null body)

**Status: shelved.** Investigated; root cause narrowed to a streaming/physics handle-pool race but not
pinned to an exact line (needs a one-shot runtime trace). No fix applied yet.

## Symptom

Intermittent (seen ~2×). Spawn a car (debug menu), walk up to it, press **Enter** → crash:

```
Uncaught TypeError: Cannot read properties of null (reading 'translation')
    at PhysicsWorld.readBody (physics-world.ts:360)
    at EnterVehicleSystem.isUpright (enter-vehicle.system.ts:473)
    at EnterVehicleSystem.beginApproach (enter-vehicle.system.ts:308)
    at EnterVehicleSystem.update (enter-vehicle.system.ts:216)
```

Reproduction signal (from the user): both times it happened **after using teleport**, then spawning a car
and trying to enter it. The crashing car is the **live, just-spawned** one (it was the only car, visible on
screen) — **not** a leftover/despawned car.

## What's established

- `readBody` has no null guard: `this.world.getRigidBody(handle).translation()` — `getRigidBody` returns
  null when the body's slot is empty (removed). `beginApproach` calls `isUpright(v)` → `readBody(v.body)` for
  **every** vehicle in `EnterVehicleSystem.vehicles`.
- The crashing car is **visible (render object present)** and **still in `enterVehicle.vehicles`** (else
  `beginApproach` wouldn't reach it), yet its physics body is gone. That **rules out `despawn`** — despawn
  removes the body **and** the render object **and** the enter-registry entry (and it removes the entry before
  the body). So the body was removed by a path that touches **only the physics body**.
- The only body-only removal is **`CollisionStreamingSystem` (`removeBodies`)**. Vehicle dynamic bodies and
  streamed static cell colliders live in **one Rapier world and share one handle pool**.

## Hypothesis (root cause)

A **handle-pool race** between collision streaming and vehicle spawn:

- **Teleport** forces collision streaming to unload a large batch of old cells in one `update()` →
  frees many rigid-body handles at once.
- The **freshly spawned** car's dynamic body (`createDynamicVehicle`) reuses one of those freed handles.
- A bookkeeping/timing edge in collision streaming then calls `removeBodies(...)` on that handle (now the
  car's) → the car's body is removed while its render object + enter-registry entry remain → `readBody`
  returns null on the next Enter.

Teleport is the trigger because it produces the burst of freed handles + cell churn right before the spawn.

## Why it wasn't pinned statically

Walked every path — `update()` unload, the async `load()` guard (`current.has(key)`), `createStaticColliders`
(only records handles for bodies it keeps), `removeBreakable`/`forgetBreakables` (clean `breakableByHandle`),
`reload()` (only fired by the clutter/draw-distance knobs, not teleport). Under Rapier's invariant — a **live**
handle is never reassigned — none of these should be able to remove a live vehicle's body. So the defect is a
**timing/ownership edge on the streaming↔spawn boundary** that needs a runtime trace to localize, not static
reading. (An earlier theory — "a despawned car left stale in the enter registry" — was **refuted** by the
report: the car was live and visible.)

## How to confirm (when we return)

One-shot instrumentation, then repro **teleport → spawn → Enter**:

- log `vehicle.body` at spawn (`createDynamicVehicle` return), and
- log every handle list passed to `PhysicsWorld.removeBodies` (with a short stack).
  If the spawned car's handle appears in a `removeBodies` call, that pinpoints the offending site (expected:
  `CollisionStreamingSystem.update`/`reload`).

## Fix options

1. **Defensive (immediate, low risk).** Make `readBody`/`isUpright` tolerate a missing body (return null /
   treat as not-enterable) and prune dead entries from `EnterVehicleSystem.vehicles`. Stops the crash
   regardless of the underlying race. Add a test (a registered vehicle whose body was removed doesn't crash
   `beginApproach`).
2. **Structural (root).** Decouple handle ownership so streaming can never remove a vehicle's body — e.g. tag
   vehicle handles, or have `removeBodies` only drop handles the caller created. Removes the whole class of
   bug.

Recommended: trace to confirm (1 run) → structural fix + the defensive guard.

## Reproduce

Debug menu → teleport somewhere → spawn a car → walk to it → press Enter. Intermittent; the teleport step
appears necessary (it supplies the freed-handle churn).

Related: `src/game/vehicle/enter-vehicle.system.ts`, `src/game/physics/physics-world.ts`
(`readBody`/`createDynamicVehicle`/`removeBodies`), `src/game/streaming/collision-streaming.system.ts`,
`src/ui/canvas-host.tsx` (vehicle spawn/despawn + teleport).
