# 059 — map car generators (binary IPL CARS → spawned cars)

**Plan — parser landed (phase 1); the rest is design.** SA's map-baked parked/spawned cars live in the **`CARS`
section of the binary IPL streams inside `gta3.img`** (≈1043 in stock SA: ~300 specific-model + ~740 random), a
mechanic our engine ignored — `parseBinaryIpl` reads only INST. This plan wires those car generators into the
existing parked-vehicle spawn path, including resolving the **random** (`id = -1`) ones via `cargrp.dat` + zones.
See [[binary-ipl-cars-section]].

## Findings (measured on `game-src/non-modified`)

- Binary IPL header: `numCars @0x14`, `carsOffset @0x3C`. Record = **48 bytes**: `pos f32×3 (Z-up)`, `angle f32`,
  `modelId i32`, `primCol i32`, `secCol i32`, `forceSpawn i32`, `alarm i32`, `doorLock i32`, + 8 unused.
- `modelId = -1` → a **random** area-appropriate car; a specific id (400–611) → that model.
- `primCol/secCol = -1` → random colour.
- `angle` is in **radians** in stock streams (confirmed: a south-facing car reads `-π`), so heading needs **no**
  `·π/180` — unlike the CLEO generators ([[cleo-car-generator-parsing]]).
- These are the same concept as `parked.json`'s CLEO `0x014B` generators, just embedded in the map.

## Available inputs (verified)

| Need                      | Have                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ |
| id → model name           | `parseVehicleDefs` (`vehicles.ide`, `cars` — keyed by model)                         |
| car models per group      | `parseCarGroups` (`cargrp.dat`) — 34 groups, each labelled `# POPCYCLE_GROUP_<NAME>` |
| zones / city              | `parseZon` (`map.zon` + `info.zon`) + the zones systems                              |
| colour palette per model  | `parseCarcols` (`carcols.dat`)                                                       |
| zone-type → group weights | `popcycle.dat` **now present** (added to `game-src/data`) — needs a `parsePopcycle`  |

**How the group names line up (the key to random resolution):** `cargrp.dat`'s 34 groups are each tagged
`# POPCYCLE_GROUP_<NAME>` (WORKERS, BUSINESS, CLUBBERS, FARMERS, BEACHFOLK, CASUAL_RICH…). `popcycle.dat` is a set
of **zone-type** blocks (BUSINESS, COUNTRYSIDE, RESIDENTIAL_RICH, GANGLAND, BEACH…), each with a per-time-of-day row
whose columns are **those same group names** — i.e. the population-group **weights** for that zone+time. So the full
chain is available: zone → popcycle weights → weighted group pick → `cargrp` models → random model. (`popcycle.dat`
also caps `#Cars` per zone+time — useful later for density budgeting.) `popcycle.dat` is **not yet parsed**, so a
`parsePopcycle` parser is the one new piece phase 3b needs.

## Pipeline (per car generator → `VehiclePlacement`)

`IplCarGenerator` → the existing `VehiclePlacement { model, position, heading, colour? }` (fed to the vehicle
LOD/spawn system, same as `parked.json`):

1. **Model** — `id ≥ 0`: reverse-lookup `id → model` from `vehicles.ide`. `id = -1`: **random resolution** (phase 3).
2. **Heading** — `heading = angle` (already radians).
3. **Colour** — `primCol/secCol ≥ 0` → `'prim,sec'` (done); `-1` → omit for now, so the spawner uses the car's
   default. Picking a random valid combo from the model's `carcols.dat` for the `-1` case is **phase 4** (subsumes
   the postponed `parked.json` colour task) — not yet implemented.
4. **Position** — the IPL position (Z-up), with a `groundSnap` flag so the spawner seats the body **on the ground**
   (raycast `groundBelow` from just above, then `ground + chassis half-height`). Without it, IPL spots that sit in
   tight/clipping places (parking lots under freeways, against curbs) penetrate static collision on spawn and the
   dynamic chassis is **ejected → tips vertical**. `parked.json`/CLEO placements don't set the flag (unchanged).

## Where it plugs in — **chosen: B (runtime, implemented)**

- **B — runtime, in the map resolver ✅:** `resolveMap` collects CARS into `MapDefinitions.carGenerators`;
  `GtaSaWorldAdapter.mapCarGenerators()` converts them to `VehiclePlacement` and `canvas-host` hands them to the
  vehicle LOD system (which culls/streams parked cars by distance). Live data, no build step, no extra file. Spawned
  behind the same LOD manager as `parked.json`/CLEO so density stays bounded.
- **A — offline extract** (rejected): a build step writing `map-cars.json` merged with `parked.json`. No runtime
  cost, but a per-game build artifact, stale on map edits. Kept here only as the alternative considered.

## Random-car resolution (`id = -1`) — the interesting bit

SA picks the car from the zone's **popcycle** population groups, and (now that `popcycle.dat` is shipped) we can do
this properly. Two cuts:

- **Phase 3a (approximation, no parser):** resolve the generator's position → **city** (`map.zon`, already
  classified by the zones feature) → a curated city→`cargrp.dat` group set → pick a model with a **seeded** RNG
  (seed = quantised position, so it's deterministic + stable across reloads). Good enough to populate the world
  while 3b lands.
- **Phase 3b (fidelity):** `parsePopcycle` + a seeded **weighted** resolver, then `(zone-type, hour) → model`.
  **Parser + resolver: ✅ done** (see Phases). Measured: `popcycle.dat` = **20 zone-types**, each 12 weekday + 12
  weekend 2-hour slots, 24 columns/row; the 18 group-weight columns are **index-aligned to `cargrp.dat`'s 18
  `POPCYCLE_GROUP_*` groups** (Workers…Aircrew_runway). `randomCarModel` weights the groups by the slot, seeded-picks
  a group, then a seeded model from its cargrp group.
- **⚠️ Open question — the position → zone-type source.** The one thing **not** in the shipped data: which of the 20
  zone-types a world position belongs to. `info.zon`'s type column is `0` for every zone (all `ZONE_INFO`); SA sets
  the popcycle zone-type in the **executable/mission script**, not a data file. So the resolver is ready but needs a
  zone-type source. Options:
  - **B1 — city approximation (recommend, data-driven now):** reuse the existing `map.zon` city classification
    (LA/SF/VEGAS/COUNTRYSIDE/DESERT) → a representative zone-type each (COUNTRYSIDE→`COUNTRYSIDE`, DESERT→`DESERT`,
    cities→e.g. `RESIDENTIAL_AVERAGE`). Coarse (loses BEACH/GANGLAND/INDUSTRY granularity) but immediate and honest.
  - **B2 — curated zone-name → type table (fidelity, later):** map `info.zon` zone names → popcycle type from a
    reference table (the SA-accurate assignment). Bigger, exact.
- **Fixture:** `data/popcycle.dat` added to `scripts/test-fixtures.ts`. `popcycle.dat`'s `#Cars` cap can later feed
  the LOD manager's per-area density budget.

## Phases

1. **Parser** ✅ **Done.** `parseBinaryCarGenerators(buffer) → IplCarGenerator[]` (+ `IplCarGenerator` type), a
   non-breaking sibling of `parseBinaryIpl` (same header, reads the CARS section). Unit tests (synthetic
   specific + random records, empty section, bad magic) + a real-data test on the committed `lae_stream0.ipl`
   fixture (2 random generators). `packages/renderware/src/parsers/text/ipl-binary.parser.ts`.
2. **Specific-model spawn** ✅ **Done.** `resolveMap` collects the binary streams' CARS into
   `MapDefinitions.carGenerators`. `GtaSaWorldAdapter.mapCarGenerators()` resolves `id → model` from
   `vehicles.ide` and converts the `id ≥ 0` ones to `VehiclePlacement` (heading = angle, colour from prim/sec) via
   the pure `carGeneratorPlacements` helper (`game/adapters/`); `id = -1` skipped. New
   `VehicleLodSystem.register(placement)` registers them **lazily** (no upfront spawn — the stream loop
   materialises each only when the view nears it, so ~300 map cars don't spike load). Wired in `canvas-host`
   after the `parked.json` loop, with **ground-snap on spawn** (the `groundSnap` flag → `groundBelow` raycast →
   seat on `ground + half-height`, so the chassis doesn't penetrate collision and get ejected). Unit-tested
   (parser, resolver, converter, lazy register, flag); **in-game verified** (cars stand on their wheels).
3. **Random resolution (3b)** ✅ **Done (B1 city approximation).** `parsePopcycle(text) → Map<zoneType,
PopcycleZone>` (`renderware`; tested incl. the real 20-zone fixture) + `randomCarModel` + `randomCarPlacements`
   - `positionSeed` (`game/adapters/popcycle-cars.ts`; seeded weighted group pick → cargrp model, then per-position
     placement). The adapter loads `popcycle.dat` + `cargrp.dat` (absent-tolerant) and maps **city → zone-type** via
     `CITY_POPCYCLE_ZONE` (countryside/desert 1:1; cities → `RESIDENTIAL_AVERAGE`); `mapCarGenerators({ cityAt, hour })`
     now returns specific **+** random placements. `canvas-host` passes `cityAt` (from the `map.zon`/`info.zon` boxes)
   - `game.getHours()`. Resolved once at load (static cars), seeded by position. Unit-tested; **in-game verified**.
     The exact per-zone source (B2) remains a later fidelity upgrade.
4. **Colour-from-carcols** — `-1` colours pick a random valid combo from the model's `carcols.dat` (subsumes the
   postponed `parked.json` colour task; share the helper).

## Out of scope (now)

- `forceSpawn` / `alarm` / `doorLock` semantics; respawn-on-destroy timing (these are full car-generator runtime
  behaviour — we just place the car).
- Boats/planes among the generators (some ids are non-cars) — gate by `vehicles.ide` type if needed.
- Per-zone/time **density budgeting** from popcycle's `#Cars` cap (phase 3b can wire it into the LOD manager; the
  initial cut just spawns every generator and lets the existing distance LOD bound the count).
- **Ground-snap beyond collision range.** The snap raycast only finds ground where collision is streamed
  (`collisionDrawDistance ≈ 150 m`); cars that spawn in the 150–250 m band (vehicle `lodDistance`) fall back to the
  raw IPL z. In practice they spawn into empty space and settle onto collision as the player approaches, so the
  visible (near) cars are correct — gating the spawn on collision presence is a possible later refinement.
