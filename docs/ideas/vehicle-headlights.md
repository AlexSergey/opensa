# Idea — Real headlights on the road at night

**Status:** idea / not scheduled. Captured from a design discussion.

Make car headlights actually **illuminate the road** at night (a beam / pool of light that conforms to the
asphalt, curbs, walls), not just glow the lamps.

## Current state (MVP)

`packages/game/src/vehicle/vehicle-headlight.system.ts`: the occupied car's lamps get **emissive glass** + **corona
sprites** at night, gated on `seated && isNight()`; bloom makes the halo. **No light hits the world** — the
map is unlit/prelit (plan 038), so there's no beam on the asphalt.

## Dead-ends already ruled out (do NOT retry as-is)

From the system's own notes:

- **Real `SpotLight`** — can't light the unlit world material; barely visible even on dynamics. ✗
- **Flat ground decal / light pool** (a quad on the road) — sliced by uneven geometry, z-fights, ignores
  slope; reads badly. ✗

## Approach that fits our architecture

Same root cause as the sun discussion: **the unlit map ignores real 3D lights**. So the headlight
contribution must be **injected into `world-material`** — exactly the mechanism that already feeds the sun's
shadow into the unlit shader.

- The world fragment shader already has **`vWorldPosition`** (used for shadow sampling). Add a uniform with a
  small set of active headlights `{worldPos, dir, cone/penumbra, color, range}` and compute a **world-space
  spot-cone term** per fragment: vector-to-light → distance attenuation → cone cutoff → **additive** onto
  `prelit × tint`, gated by `dnBalance`. Bloom turns bright spots into the glow.
- **Why this beats the rejected decal:** it's **per-fragment in world space**, so the pool **conforms to**
  road/curbs/walls/slopes automatically — no slicing, no z-fight. And no 3D light → the unlit world is fine.
- `world-material` becomes the single hub for "how the unlit map reacts to light": sun shadow (done),
  optional sun diffuse, and headlights — each a small additive injection driven by uniforms.

## What we already have / what's needed

Have: headlight `headlightDummy` / `taillights` positions + direction (the system uses them), `vWorldPosition`
in the world shader, night gating, `dnBalance`.

Needed:

- A **small fixed uniform array of active lights** (player + N nearest cars), forward loop in the shader;
  **cull AI traffic to the nearest few** (SA effectively lit only the player / close cars).
- For the beam to climb **walls** correctly, **conditioned normals** (N·L) → ties to
  [map-optimizer.md](./map-optimizer.md). A **ground-only** pool can skip normals (assume up + cone) as an
  MVP.

## Dynamics caught in the beam (oncoming car / ped)

They're on lit `MeshStandard` materials. Optional, later: either inject the headlight into their material too,
or add a small real spotlight that affects only dynamics (it composes once the road itself lights up). MVP is
the **road pool first** — that's the visible win.

## Open questions / decisions for later

- MVP scope: **ground-only** (no normals, fastest) vs **geometry-correct** (needs map-optimizer normals).
- Light count + culling cadence (how many lights, how often we refresh the active set).
- Perf budget of the forward loop in the world shader (night-only, few lights → should be cheap).
- Taillights: red running/brake glow is mostly the emissive lamps already; a faint rear pool is optional.

Related: [map-optimizer.md](./map-optimizer.md), [plan 038](../plans/038-sa-prelit-lighting.md).
