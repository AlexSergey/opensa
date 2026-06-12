# 019 — Vehicle collision damage

## Goal

Real GTA-style panel damage on the dynamic cars (plan 018):
- A **strong** collision deforms the body part **at the hit location** (`_ok` → `_dam` mesh).
- A **second** strong hit on an already-damaged part makes it **fall off** (drop to the ground,
  disappear after ~1.5 s).
- Hitting a wall/obstacle gives a small **bounce back** (not a dead stop).

## Approach

- **Impact detection** — chassis colliders emit Rapier contact-force events; `PhysicsWorld.step`
  drains them into `Impact { bodyA, bodyB, force, direction, point }`; `takeImpacts()` hands them to
  the damage system. `collider.parent()?.handle` maps a collider → its body.
- **Hit location** — use the **contact point** (`ContactManifold.solverContactPoint`, world space),
  transformed into the car's local frame, then pick the **nearest** damageable part by distance.
  (The force *direction* is unreliable for the hit side — its sign depends on collider order.)
- **Parts** — `buildVehicle` pairs `<prefix>_ok`/`<prefix>_dam` atomics into `BuiltPart`
  (ok shown, dam hidden, under a pivot at the part's world transform). Damageable on admiral/camper:
  bonnet, boot, bump_front/rear, windscreen, doors, plate_rear.
- **Damage system** (`VehicleDamageSystem`) — per update, drains impacts; for each strong impact on a
  car, finds the hit part → deform (`_ok`→`_dam`) the first time, **detach** (reparent out, fall under
  gravity + tumble, remove after `FALL_TTL`) if already damaged. At most one state change per part per
  frame (a multi-contact crash doesn't deform-then-detach the same panel instantly).
- **Bounce** — chassis colliders carry a little restitution (`Max` combine rule).

## Iterations

1. **Impact events + bounce** — contact-force events in PhysicsWorld; restitution. ✅ DONE
2. **Damage parts in the model** — `_ok`/`_dam` pairs exposed as `BuiltPart`/`VehiclePart`. ✅ DONE
3. **Damage application** — deform on strong hit, detach + fall on the second. ✅ DONE (logic)
4. **Calibration + correct hit mapping** — set `STRONG_HIT` from real contact forces; map hits by
   **contact point** (fix "rear hit damaged the front"); dedup one change per part per crash. ← NOW
5. **Polish (later)** — per-part force thresholds, deformed handling feel, debris/smoke, persistence.

## Calibration data (from in-browser)

Contact-force magnitudes: curb ≈ 1.4k; super-light touch ≈ 76k; light touch ≈ 207k; strong hit ≈ 377k.
→ `STRONG_HIT` ≈ **300k** (light touches don't deform; a real crash does). Tune further if needed.

## Out of scope (for now)

Panel deformation morphing (we swap whole `_ok`/`_dam` meshes, as GTA does), engine/smoke states,
glass shatter particles, wheel/tyre damage, AI-traffic damage.
