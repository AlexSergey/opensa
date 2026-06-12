# 044 — World effects: 2dfx particles + animated effect objects

## Context

Split out of plan 043 (DFF/TXD completeness): the parser-side gaps that need a RENDER system
behind them, not just parsing. Survey data from `scripts/find-2dfx.ts` (byte-accurate, full
map): **113 particle entries (type 1)** and **6 escalator entries (type 10)**.

Particle effect names in shipped data (count):

| Effect | Count | Visual |
| --- | --- | --- |
| `WS_factorysmoke` | 20 | factory chimney smoke columns |
| `smoke30lit` / `smoke30m` / `smoke50lit` | 11 / 7 / 6 | ambient smoke plumes |
| `insects` | 10 | bug swarms (dumps, swamps) |
| `cigarette_smoke` | 10 | thin smoke wisps |
| `vent` / `vent2` | 10 / 7 | steam vents |
| `waterfall_end` | 9 | waterfall splash mist |
| `fire` | 8 | open flames |
| `water_fountain` | 6 | fountains (the Strip, parks) |
| `cloudfast` | 3 | fast cloud puffs |
| `water_fnt_tme` | 1 | timed fountain |
| `prt_spark` / `prt_spark_2` | 2 | sparks |

(A few garbage rows in the survey output are byte-scanner false positives — the runtime parser
walks the real chunk tree and won't see them.)

## SA effects architecture (research, 2026-06-12)

- `models/effects.fxp` — TEXT "FX project": named particle systems (`FX_SYSTEM_DATA`), each
  with emitter prims (`FX_PRIM_EMITTER_DATA`) and keyframed parameter tracks: EMRATE, LIFE,
  SIZE, COLOUR (RGBA over particle life), VELOCITY/FORCE, ROTATION, texture names + animation
  frames, blend mode (additive fire vs alpha smoke).
- `models/effectsPC.txd` — the textures those systems reference (flame frames, smoke puffs,
  water spray, sparks).
- The 2dfx type-1 entry name IS the FX system name; the engine instantiates the system at the
  entry position attached to the entity. Positions are geometry-LOCAL (like lights, unlike
  roadsigns).
- **Prerequisite: copy `effects.fxp` + `effectsPC.txd` from the SA install into
  `static/models/`** (neither is in our assets yet).

## Iterations

1. **Parser. — DONE** 2dfx type 1 → `RWParticle2d { effectName, position }` on
   `RWGeometry.particles` (entry data = char[24] effect name; same walk as lights/roadsigns).
   Real-asset fixture + tests (`particle.test.ts` on `skullpillar01_lvs`: 1 entry, `fire`,
   pos (0, −0.3, 2.1)). First verification target: the skull-torch fire by the pirate ship (LV).
2. **Data-driven emitters. — DONE (verified in browser: skull-pillar fire by the pirate ship)**
   - `parseFxp` (`parsers/text/fxp.parser.ts`): systems → emitters → keyframed tracks
     (`"<info>.<channel>"`), `sampleFxTrack` linear interp. Tested on the real
     `static/models/effects.fxp` (80+ systems, fire/prt_blood reference values).
   - `build-particles.ts`: `setFxLibrary(systems, textures)` registry; `buildParticleEmitters`
     bakes each system's tracks into per-particle attributes (velocity cone, life±bias, phase;
     deterministic mulberry32) + uniforms (colour/alpha/size start→end, force, CULLDIST fade);
     lifecycle loops entirely in the vertex shader off `particleTimeUniform`. One `Points` per
     (system, emitter layer) per cell; additive when DSTBLENDID=1; everything on `GLOW_LAYER`;
     heat-haze prims skipped (refraction — out of scope). 48 particles/emitter cap.
   - Plumbing: `buildClumpParticles` (frame-transformed local entries),
     `collectParticleEmitters` in build-region (instance placement → world entries, same walk
     as coronas), `buildCell` HD ring only; canvas-host loads `effects.fxp` + `effectsPC.txd`
     (absent-tolerant) and drives the time/viewport uniforms.
   - Gotcha (found via `scripts/dump-fx-system.ts`): fire keeps its colours in COLOURBRIGHT
     tracks (not COLOUR) with a 0→peak@0.75→0 alpha envelope — hence the COLOUR→COLOURBRIGHT
     fallback and the 3-sample (age 0/0.5/1) piecewise envelope for colour/alpha/size.
   - Live config (post-verification): `graphics.effects { enabled, drawDistance }` (init config
     + debugger → Graphics → "World effects"), gated per frame like the procobj registry. The
     configured `drawDistance` **REPLACES** the systems' authored CULLDIST rather than capping
     it: vanilla culls are tiny (fire = 35 m) — effects only appeared near-point-blank and the
     slider had no authority above the authored value. Default 150 m, fade over the last 20%,
     shared `uDrawDistance` uniform keeps the CPU cutoff aligned with the GPU fade.
3. **Escalators (2dfx type 10, ×6). — DONE (verified in browser: LA mall pairs)** Parser:
   `RWEscalator { position, bottom, top, end, direction }` — geometry-local path points
   (survey-confirmed), path = start → bottom (lower landing) → top (incline) → end (upper
   landing), dir 1 = up / 0 = down. Runtime: `buildClumpEscalators` + `buildEscalatorMeshes`
   (instance placement walk) + `buildEscalatorSteps`/`updateEscalators` rig registry — steps
   instanced from the vanilla `esc_step` model (textures escstep.txd), looping along the
   3-segment polyline at 0.45 m/s, horizontal like SA (staircase on the incline, sunk under
   the floor on landings). Hosts: escl_la (×4 placements, opposed pairs), escl_singlela,
   shack02, vgseesc01/02 (LV casino travelators). "LS - Escalators" teleport in the debugger.
4. **Verification.** Fountains on the Strip, factory smoke in SF/LS industrial, waterfall in
   the countryside; perf check (one draw call per active effect type per cell budget).

## Out of scope

- Full SA particle engine — we bake fxp tracks into static start→end uniforms (no per-key
  interpolation in-shader), no particle rotation, no texture animation frames, no heat haze.
- **Escalator physics — REVISIT LATER.** Steps are render-only: no step colliders, so the
  player falls through the step row and cannot ride it. Vanilla behaviour to reproduce: steps
  carry standing entities along the path (SA moves entities standing on a step with it).
  Likely shape: a static ramp collider along the incline (host COL may already have one — the
  LA mall hosts need checking) + a per-frame velocity impulse while the player stands on it.
- **Escalator step collision — REVISIT LATER** (same item as above, split for clarity): no
  per-step moving colliders; if a ramp collider exists in the host COL the player just slides
  on a static slope through the moving steps.
- Breakable objects — separate dedicated plan (per plan 043 note).
- 2dfx types 3/4/6/8/9 (attractors/glare/enex/triggers/cover) — see plan 043 N/A list.
