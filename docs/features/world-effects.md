# World effects (2dfx particles + escalators)

Data-driven particle emitters for the map's 2dfx type-1 entries (plan 044): fires, smoke
columns, steam vents, fountains — 113 entries across the shipped map, each naming a system in
`effects.fxp`. Plus the 2dfx type-10 escalators (×6): moving step rows along baked paths.

## Implemented

- **2dfx type-1 parsing** — `RWParticle2d { effectName, position }` on `RWGeometry.particles`
  (`parsers/binary/dff.ts`); positions are geometry-local (like lights, unlike roadsigns).
- **effects.fxp parser** — `parseFxp` (`parsers/text/fxp.parser.ts`): `FX_SYSTEM_DATA` blocks →
  `FxSystem { cullDist, boundingSphere, emitters }`; each `FX_PRIM_EMITTER_DATA` →
  `FxEmitter { texture, srcBlendId, dstBlendId, tracks }` with keyframed tracks keyed
  `"<info>.<channel>"` (emrate.rate, emlife.life/bias, emspeed.speed/bias, emdir.dir*,
  emangle.min/max, force.force*, size.sizex/y, colour.red/green/blue/alpha). `sampleFxTrack` =
  clamped linear interpolation.
- **Runtime emitters** — `three/build-particles.ts`: `setFxLibrary(systems, textures)` set once
  at bootstrap (`effects.fxp` + `effectsPC.txd`, absent-tolerant — no files, no particles).
  `buildParticleEmitters` bakes tracks into per-particle attributes (velocity cone around
  EMDIR within EMANGLE, life±bias, phase; deterministic mulberry32 so rebuilt cells are
  identical) + uniforms (colour/alpha/size sampled at age 0/0.5/1 — piecewise envelope, covers
  the 0→peak→0 fire shapes; COLOUR with COLOURBRIGHT fallback; force, CULLDIST fade). The
  lifecycle loops entirely in the vertex shader off `particleTimeUniform` — zero per-frame CPU
  work.
- **Draw batching** — one `Points` per (system, emitter layer) per cell covering all placed
  entries; 48 particles/emitter cap. DSTBLENDID=1 → additive (flames, sparks), else normal
  alpha (smoke). All on `GLOW_LAYER` (SSAO normal-prepass safety), corona-convention
  perspective point sizing via `particleViewportUniform`.
- **Map plumbing** — `buildClumpParticles` (frame-transformed clump-local entries),
  `collectParticleEmitters` (instance placement → world entries, same walk as the coronas),
  built per HD cell only in `buildCell`.
- **Live config** — `graphics.effects { enabled, drawDistance }` (init config + debugger →
  Graphics → "World effects"): `updateParticleEffects` gates registered layers per frame like
  the procobj registry (detached layers skipped); `drawDistance` REPLACES each system's
  authored CULLDIST (vanilla fire culls at 35 m — too close) via a shared shader uniform, so
  the CPU cutoff lands where the GPU fade hits zero.
- **Escalators (2dfx type 10)** — `RWEscalator` parsing (geometry-local path
  start → bottom → top → end + direction); `buildEscalatorSteps`/`updateEscalators`
  (`three/build-escalator.ts`): steps instanced from the vanilla `esc_step` model, looping the
  3-segment polyline at 0.45 m/s, horizontal like SA (staircase on the incline, sunk into the
  floor on landings); rig registry pauses detached (streamed-out) rigs. Hosts: escl_la ×4,
  escl_singlela, shack02, vgseesc01/02.

## Known gaps

- Heat-haze prims are skipped (screen-space refraction pass not implemented).
- Tracks are baked at 3 sample points (age 0/0.5/1) — no full keyframe interpolation, no
  particle rotation (EMROTATION/ROTSPEED ignored), no texture animation frames.
- Emission rate is approximated by a fixed particle budget (`rate × life`, capped), not a
  spawn-rate simulation; EMSIZE/EMBOX emitter volumes ignored (point emission).
- **Escalator physics/collision (REVISIT)** — steps are render-only: no step colliders, the
  player can't ride them (vanilla carries standing entities with the step). Likely shape:
  static ramp collider on the incline (check the host COL first) + a velocity impulse while
  standing on it.
- Step model is always `esc_step` — the LV travelators may want the wide `esc_step8` variant.

## Test coverage

- `parsers/binary/particle.test.ts` — type-1 parsing on the real `skullpillar01_lvs.dff`
  (1 entry, `fire`, pos (0, −0.3, 2.1)); trafficlight negative/lights regression.
- `parsers/text/fxp.parser.test.ts` — real `effects.fxp`: 80+ systems, fire layer structure,
  prt_blood keyframe reference values, all 15 map-referenced effect names resolve.
- `three/build-particles.test.ts` — real fxp + effectsPC.txd + skull DFF: library-unset /
  unknown-name negatives; fire layers (no haze, additive flame, GLOW_LAYER, CULLDIST 35,
  per-entry particle counts, determinism).
- `parsers/binary/escalator.test.ts` — type-10 parsing on the real `escl_la.dff` (pair, opposed
  directions, flat landings + rising incline).
- `three/build-escalator.test.ts` — real escl_la + esc_step: empty/degenerate-path negatives,
  detached rigs stay frozen; step rows span the incline heights and move along the loop.
