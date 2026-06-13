# 045 — Breakable objects (RW Breakable plugin 0x253F2FD)

## Context

Split out of plan 043 (DFF/TXD completeness). SA map props (bins, mailboxes, bus stops,
barriers, street trees, shop windows…) carry a **Breakable** geometry extension: a complete
secondary "shatter" mesh the engine turns into flying debris when the object is smashed
(vehicle impact / weapons). We parse it and reproduce the break: hide the prop, fling the
pieces, land them on the ground, fade them out.

Survey (byte scan over static/img/gta3 + gta3additional, 2026-06-12):

- 1695 models carry the chunk; **238 have real data** (non-zero magic) — the rest are empty
  4-byte markers (`magic = 0`, "not breakable").
- Classic examples: `binnt07/08_la` (bins), `ce_mailbox1`, `bustopm`, `barrierm`, `bussign1`,
  `aw_streettree1/2`, `ce_hairpinl/r` (road signs), `cfsmashwin1_sfs` / `bd_window_shatter`
  (shop glass), `a51_ventcover`.

## Chunk layout (byte-verified on binnt08_la: 252 verts / 154 tris / 7 materials = 7868 B exact)

```
u32 magic            // 0 = not breakable (marker only); else data follows
u32 unknown          // observed 1
u32 vertexCount
u32 ×3               // file-zeroed runtime pointers (positions/uvs/colours)
u32 triangleCount
u32 ×2               // zeroed pointers (triangles/material assignment)
u32 materialCount
u32 ×4               // zeroed pointers (textures/names/masks/ambient)
                     // = 56-byte header, then packed arrays:
f32[3] × V           // positions (model space)
f32[2] × V           // UVs
u8[4]  × V           // vertex colours (RGBA)
u16[3] × T           // triangle indices
u16    × T           // per-triangle material index
char[32] × M         // texture names
char[32] × M         // texture mask names
f32[3] × M           // per-material ambient colour
```

There is no piece table: SA's BreakObject_c flings **per-triangle** shards (matches the
in-game look — clouds of small flat fragments). We do the same.

## Iterations

1. **Parser. — DONE** `RWBreakable { positions, uvs, colours, triangles, triangleMaterials,
   materials: { texture, mask, ambient }[] }` on `RWGeometry.breakable` (same
   geometry-extension walk as the 2dfx entries; `magic === 0` → undefined). Strict size check:
   header + packed arrays must sum to the chunk size exactly, else undefined. Findings:
   `magic` is a raw runtime pointer (trafficlight1 ships 376381824, not 1) — any non-zero
   means data; name fields carry exporter heap garbage after the NUL (stream.string trims).
   Fixtures: binnt08_la (252/154/7, bins2_LAe2 + _m mask) + trafficlight1 (488/242/22,
   pointer magic) positives; vegasnroad19 (zero-magic marker) + skullpillar01_lvs (no chunk)
   negatives. Bonus: trafficlight1 — an already-shipped fixture — is itself breakable.
2. **Debris renderer. — DONE** `three/build-debris.ts`: `buildDebrisMesh(breakable, transform,
   { groundZ, impact?, seed? }, textures?)` — geometry baked in world Z-up space (transform
   applied on the CPU once, mesh at identity under the streaming root, gravity = −Z in the
   shader); de-indexed per-triangle shards with attributes (centroid, velocity = 0.6×impact +
   horizontal scatter + upward pop, random spin axis 3–12 rad/s, analytic landing time from
   one ground probe); vertex shader flies/spins each shard with `t = min(age, landTime)` (so
   shards freeze where they land), fragment = vertex-colour (ambient baked in) × texture with
   a tail fade. Draw groups merged by shard texture (the bin's 7 identical materials → 1
   draw); missing textures → shared white. `spawnDebris`/`updateDebris` registry: lifetime 5 s,
   budget 8 simultaneous breaks (oldest evicted), expiry detaches + disposes. DoubleSide,
   `frustumCulled = false`, GLOW_LAYER (SSAO normal prepass would rasterize the shards
   un-animated — ghost AO). Deterministic mulberry32 (seed defaults from the placement).
3. **Break trigger + world integration. — DONE**
   - Breakable registry (`three/breakable.ts`): at HD cell build (`collectBreakables`), instances
     whose model has real breakable data register (model, world transform, part InstancedMeshes +
     slot, instance key) — mirrors the escalator/procobj registries. `nearestBreakable` +
     `breakBreakable`; re-registration replaces a stale entry on a cached-cell rebuild.
   - Hide the broken prop: zero-scale its InstancedMesh slots; drop its collider from the physics
     world. Breakable placements are tagged with their instance key (`ModelColliders.instanceKeys`)
     in the adapter, `createStaticColliders` reports key→handle, and
     `CollisionStreamingSystem.removeBreakable(key)` removes that one body (and forgets it on cell
     unload). Streaming out + back in rebuilds the cell → the prop respawns (vanilla also respawns).
   - Trigger A: debugger action — "Break nearest prop" (Player tab) breaks the nearest prop to
     the player.
   - Trigger B: vehicle impact — the REAL collision (like SA `CObject::ObjectDamage(impulse)`): the
     chassis collider follows the COL contour and Rapier emits contact-force events; each event whose
     static body is a registered breakable (`breakableKeyOf` → `getBreakableByKey`) breaks that prop
     when the force clears the threshold, seeded with the hitter's velocity. A separate impact buffer
     (`takeBreakableImpacts` vs the vehicle-damage `takeImpacts`) avoids the single-drain conflict.
   - `data/object.dat` (now in static/data): parsed (`parseObjectDat`) + loaded by the adapter,
     absent-tolerant. The break gate is the RW Breakable mesh, NOT the file — the shipped bins /
     mailboxes / signs the plan targets carry effect 0/1, not 200, yet shatter in game. object.dat
     tunes the per-prop impact threshold (higher damage multiplier → breaks easier) and marks
     huge-mass cutscene/fixed props indestructible.
4. **Verification + tuning.** Bins/mailboxes around Ganton (drive into them), bus stop on
   the Strip, perf check (a pile-up of breaks), lifetime/fade calibration against vanilla
   (~3–6 s shards, fade at the tail).
   - Trigger evolution (in-browser): a proximity probe was tried first but proved unreliable —
     over-reaching broke props ~2 m early and took out whole clusters (a frame spike from
     mass-breaking), while a tight probe broke nothing (the prop's static collider decelerated the car
     below the speed floor before the bumper reached the tiny radius, and the chassis↔base Z gap ate
     it). Replaced with the **real-collision** trigger above (Trigger B) — Rapier contact-force events
     on the chassis collider, exactly the prop the car touches, at the real force. `nearestBreakable`
     (now planar + vertical-limited) stays for the debugger "break nearest". Broken props are dropped
     from the registry so the scan stays cheap.
   - **MVP shard landing:** the placement Z is the prop base for some props but its centre for
     others, which froze tall props' shards in mid-air. So the game break omits `groundZ` — shards
     fall through and sink underground as they fade. **TODO: redo with real per-shard physics +
     ground contact** (the analytic landing path is kept in `build-debris.ts` for then).
   - **Atomic-less smash props:** many props that block the car (cardboard boxes / bin bags / some
     fences) carry NO Breakable atomic — in SA they smash via the collision-damage effect. The break
     gate is now "Breakable atomic OR object.dat smash effect (20/21/200/202)"; for the atomic-less
     ones `breakableFromGeometry` synthesizes the shatter from the **render mesh**. Also fixed the
     indestructible cutoff (was 50 000, which wrongly excluded breakable fences at mass 50 000; true
     cutscene props are 99 999 → cutoff raised to 90 000).

## In scope (answering the scoping question)

- Flying apart into per-triangle shards — yes (iteration 2).
- Landing on the ground — analytic ballistics path exists, but the game ships the MVP **sink**
  (shards fall through + fade) until a real ground probe / shard physics lands (iteration 4 TODO).
- Fade-out + despawn — yes (iteration 2).

## Out of scope

- Damaged-model swap states (`colDamageEffect` = "change model": fences with `_dam` meshes) —
  shatter-only for now.
- Weapon/melee damage (no weapons in the port yet); glass-pane special rendering (CGlass
  half-pane cracking) — shop windows shatter like any other breakable.
- Respawn timers — streaming rebuild is the respawn.

### Deferred (revisit much later — not needed now)

Owner-confirmed: keep the current MVP; do not build these yet.

- **Sounds** — break/impact SFX.
- **Real shard physics** — currently shards are analytic + sink (no ground contact); a real
  rigid-body / ground-contact pass is deferred (replaces the MVP sink).
- **Impact-force model** — currently a single `BREAK_FORCE` threshold (× object.dat damage
  multiplier); a proper impact-force/energy model is deferred.
- **Per-object impact force** — individually tuned break thresholds per model (beyond the shared
  threshold × multiplier).
- **Post-break effects on damaged props** — e.g. a knocked-over fire hydrant spraying a water jet
  (the 2dfx particle system of plan 044 could host the bursts/streams later).
