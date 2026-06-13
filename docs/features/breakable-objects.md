# Breakable objects (plan 045)

Smashable map props (bins, mailboxes, bus stops, street trees, shop windows…): the RW
Breakable plugin's shatter mesh turned into flying per-triangle debris. 238 models in the
shipped map carry real shatter data (1695 carry the chunk; the rest are `magic = 0` markers).

## Implemented

- **Parser** — `RWGeometry.breakable` (`parsers/binary/dff.ts`): positions/UVs/colours,
  triangles + per-triangle material, materials (texture/mask/ambient). Strict layout check
  (header + packed arrays must equal the chunk size); `magic` is a runtime pointer — any
  non-zero value means data; name fields are NUL-trimmed (exporter heap garbage follows).
- **Debris renderer** — `three/build-debris.ts`: one Mesh per break, geometry baked in world
  Z-up at break time; per-triangle shards with baked flight attributes (velocity = impact
  share + scatter + upward pop, random spin, analytic landing time from one ground probe).
  All motion in the vertex shader (`t = min(age, landTime)` — shards freeze where they land),
  tail fade in the fragment shader. Draw groups merged by shard texture; missing textures →
  white. `spawnDebris`/`updateDebris` registry: 5 s lifetime, 8 simultaneous breaks (oldest
  evicted), expiry detaches + disposes. DoubleSide, GLOW_LAYER (out of the SSAO prepass).
- **World registry** — `three/breakable.ts`: at HD cell build (`collectBreakables`), every placed
  prop whose model carries Breakable data registers (model, world transform, part InstancedMeshes +
  slot, instance key). `nearestBreakable` finds the closest un-broken, still-streamed prop;
  `breakBreakable` collapses its slots (zero-scale), flies the debris and marks it broken.
  Re-registration replaces the stale entry on a cached-cell rebuild.
- **Collider removal** — the smashed prop's static body is dropped so a car drives through:
  breakable placements are tagged with their instance key in `loadCellColliders`
  (`ModelColliders.instanceKeys`), `PhysicsWorld.createStaticColliders` reports each created
  breakable body's key→handle, and `CollisionStreamingSystem.removeBreakable(key)` removes that one
  body (and forgets it on cell unload). The cell rebuild respawns the prop, like vanilla.
- **Triggers** (`ui/canvas-host.tsx`) — (A) debugger "Break nearest prop" (Player tab) smashes the
  closest prop to the player (`nearestBreakable`, planar). (B) vehicle impact uses the **real
  collision**, like SA's `CObject::ObjectDamage(impulse)`: the chassis collider follows the COL
  contour and Rapier emits contact-force events for it, so each event whose static body is a
  registered breakable prop (`CollisionStreamingSystem.breakableKeyOf` →
  `getBreakableByKey`) breaks that prop when the force clears the threshold — at the real contact,
  seeded with the hitter's velocity. Contact-force events fire only for chassis colliders, so the
  on-foot player can't smash props (matching vanilla). The same events feed the vehicle-damage system
  via a separate impact buffer (`takeBreakableImpacts` vs `takeImpacts`), so neither starves the other.
- **object.dat** — `parseObjectDat` (loaded by the adapter, absent-tolerant). A prop breaks if it has
  a Breakable atomic OR its object.dat collision-damage effect is a smash effect (20/21/200/202);
  object.dat also tunes the per-prop impact threshold (higher damage multiplier → breaks easier) and
  marks indestructible props by mass (cutoff 90 000 — true cutscene/fixed props are mass 99 999;
  breakable fences sit at 50 000, an uproot value, so they still break).
- **Render-geometry fallback** (`breakableFromGeometry`) — smash props with no Breakable atomic
  (cardboard boxes, bin bags, some fences) shatter their **visible mesh**: the adapter passes the
  object.dat smash set into the cell build, and `collectBreakables` synthesizes a shatter mesh from
  the render geometry (positions/UVs/prelit colours/triangles, texture names lowercased to match the
  TXD) when a model is in the set but has no atomic.

## Known gaps

- **Shards sink underground (MVP), no real landing** — the placement Z is the prop base for some
  props but its centre for others, which froze tall props' shards in mid-air. So the game break omits
  `groundZ`: shards fall straight through and sink as they fade (`build-debris.ts` keeps the analytic
  landing path for when a real ground probe exists). **TODO: redo with real per-shard physics +
  ground contact.**
- `BREAK_FORCE` threshold (canvas-host) is a first-pass value — recalibrate against vanilla feel via
  `showLogs: 'debug'` (the `breakable` log prints each hit's force).
- Damaged-model swap states (`_dam` meshes) not handled — shatter only.

### Deferred (revisit much later — not needed now)

Owner-confirmed: keep the current MVP; do not build these yet.

- **Sounds** — break/impact SFX.
- **Real shard physics** — shards are analytic + sink (no ground contact); real rigid-body / ground
  contact is deferred.
- **Impact-force model** — a single `BREAK_FORCE` threshold (× object.dat multiplier) for now; a
  proper impact-force/energy model and **per-object** break thresholds are deferred.
- **Post-break effects on damaged props** — e.g. a knocked-over fire hydrant spraying water (could
  ride the plan 044 particle system later).

## Test coverage

- `parsers/binary/breakable.test.ts` — real binnt08_la (252/154/7, texture+mask names,
  model-space sanity) + trafficlight1 (pointer magic, garbage-trimmed names); zero-magic
  marker (vegasnroad19) and chunk-less (skullpillar01_lvs) negatives.
- `three/build-debris.test.ts` — real bin shatter mesh: de-indexed counts, world placement,
  upward velocities + positive landing times, texture-merged single draw group, GLOW_LAYER;
  determinism per seed; impact-velocity seeding; lifetime despawn + budget eviction negatives.
- `three/breakable.test.ts` — registry: nearest within radius (planar match + vertical limit), slot
  collapse + one debris mesh on break, key resolution (`getBreakableByKey`), stale-entry replacement,
  render-geometry fallback (`breakableFromGeometry` counts + lowercased texture); negatives (out of
  radius, double-break, streamed-out, other floor).
- `parsers/text/object-dat.parser.test.ts` — comment/short/non-numeric rows skipped; real
  object.dat (bins keep change_model effect; indestructible props carry huge mass).
- `streaming/collision-streaming.system.test.ts` — `removeBreakable` drops only the prop's body +
  clears the reverse `breakableKeyOf` lookup; no-ops for unknown key / null handle.
