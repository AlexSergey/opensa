# 015 — Vehicle loading (parse + place static cars)

## Goal

Parse the GTA SA vehicle data files and **render two cars statically on the map** near Tommy's spawn:
**admiral** (2-colour) and **camper** (4-colour). No vehicle physics/driving yet — just parse + place a
painted, textured, wheeled car body. Later phases (explicitly deferred by the user): **dummy** (component
system / wheel rotation / doors / lights / seats), **collision**, **physics** (driving), **vehicle_vlo**
(LOD), **damage** (ok/dam swap).

## What we have (verified — everything needed for parse + static placement is present)

- `static/vehicles/{admiral,camper}.dff` + `.txd` — parse fine (admiral 22 atomics / 47 frames, camper 22 /
  43). `static/models/generic/vehicle.txd` (19 textures, RGBA8888) — the shared vehicle textures. Car `.txd`
  (DXT1) holds car-specific textures (`admiral92interior128`, `admiral92wheel64`). **Both TXDs must be merged**
  into one texture map (generic + car) — the car DFF references textures from both.
- `static/data/vehicles.ide` `cars` section columns: `id, model, txd, type, handlingId, gameName, anims,
class, frq, flags, comprules, wheelModelId, wheelScaleFront, wheelScaleRear, upgradeClass`. **admiral
  0.68/0.68, camper 0.66/0.66.**
- `static/data/carcols.dat`: `col`…`end` = **palette** (one `R,G,B  # i name` per line, index = order);
  `car`…`end` = per-car **2-colour** combos (`name, p,s, p,s, …` palette-index pairs; game picks one);
  `car4`…`end` = **4-colour** cars (`name, c1,c2,c3,c4, …` quads). admiral = `34,34 35,35 …`; camper =
  `1,31,1,0 …`.
- `static/data/handling.cfg`: one line per `handlingId` = ~30 space-separated physics fields (mass, drag,
  dimensions, centre-of-mass, %submerged, traction, gears, max speed, …). **Parse into a dict now; physics
  uses it later.**
- **Vehicle DFF structure (key facts):** frames include the body root, **dummies** (`wheel_lf/rf/lb/rb_dummy`,
  `chassis_dummy`, `door_*_dummy`, `bonnet/boot/bump_*/windscreen_dummy`, `engine`, `exhaust`, `ped_*seat`),
  component atomics with **`_ok` (undamaged) / `_dam` (damaged)** variants, a **`chassis_vlo`** low-detail
  body, and a **single `wheel` atomic** instanced at the 4 wheel dummies. **Paint markers** in material
  colours: **`(60,255,0)` = primary**, **`(255,0,175)` = secondary** — these materials get the carcol colour
  (tinting their texture); other materials keep their colour/texture. (Our generic `buildMaterial` forces
  white when textured → a vehicle-specific material builder is needed so paint tints show.)

**Conclusion: nothing missing.** No new assets; all files parse.

## Design

### Parsers (`renderware/parsers/text` + a small vehicles module)

- `parseHandling(text) → Map<handlingId, HandlingEntry>` — split each non-comment line; store fields (named
  where useful, else a `number[]`). Keyed by handlingId.
- `parseVehicleDefs(text) → Map<id, VehicleDef>` from the `cars` section (reuse `sectionedParse`):
  `{ id, model, txd, type, handlingId, gameName, wheelScale: [front, rear], wheelModelId }`.
- `parseCarcols(text) → { palette: [r,g,b][]; cars: Map<name, [number, number][]>; cars4: Map<name,
[number, number, number, number][]> }` (lowercased names; strip `#` comments).

### Vehicle mesh builder (`renderware/three/build-vehicle.ts`)

`buildVehicle(clump, textures, { primary, secondary, wheelScale }) → THREE.Group`:

- Render the **body**: chassis + each component atomic, but **skip `*_dam`** and **`chassis_vlo`** (and the
  bare `wheel` atomic — placed separately). Each atomic uses its frame's world transform (the `_ok` parts are
  positioned by their frames).
- **Wheels:** instance the `wheel` geometry at each `wheel_*_dummy` frame's world transform, scaled by
  `wheelScale` (front dummies → front scale, rear → rear).
- **Paint material builder:** like `buildMaterial` but for marker colours — `(60,255,0)` → `primary`,
  `(255,0,175)` → `secondary` — set `material.color = paint` (tints the texture, not forced white); other
  materials as usual. (4-colour: primary+secondary now; 3rd/4th later.)

### Adapter + placement

- `WorldAdapter.loadVehicle(modelName) → Object3D` (or a lower-level signature): resolve the def
  (`vehicles.ide` → txd + wheelScale), the colours (`carcols` palette + the car/car4 entry → primary/secondary
  RGB), load the car DFF + car TXD + generic `vehicle.txd` (merged texture map), `buildVehicle`. Cache the
  parsed data files.
- Bootstrap: `loadVehicle('admiral')` + `loadVehicle('camper')`, place near `PLAYER_SPAWN` on the Ganton
  parking lot (offsets to the side, clear of garbage/poles; heading along the lot; sit on the ground z),
  add under `game.getStreamingRoot()` (−90°X, static). Tune positions in-browser.

## Module touch list

```
src/renderware/parsers/text/handling.parser.ts   # parseHandling
src/renderware/parsers/text/vehicle-defs.parser.ts # parseVehicleDefs (vehicles.ide cars)
src/renderware/parsers/text/carcols.parser.ts     # parseCarcols (palette + car + car4)
  (+ barrel exports + types)
src/renderware/three/build-vehicle.ts             # buildVehicle (body/ok, wheels@dummies, paint markers)
src/game/interfaces/world-adapter.interface.ts    # + loadVehicle(...)
src/game/adapters/gta-sa-world.adapter.ts          # implement loadVehicle (resolve def+colours, merge txds, build)
src/ui/canvas-host.tsx                             # load admiral + camper, place near spawn
```

## Iterations (each keeps `npm test` + the app green)

1. **Data parsers.** `parseHandling`, `parseVehicleDefs`, `parseCarcols` (+ types, barrel, tests). Verify on
   the real files (admiral/camper rows; palette length; admiral 2-colour, camper 4-colour). Record the
   handling dict + formats in memory.

2. **Vehicle mesh builder.** `buildVehicle` — body (chassis + `*_ok`, skip `*_dam`/`*_vlo`), wheels instanced
   at the 4 `wheel_*_dummy` frames (scaled), paint-marker material builder (primary/secondary). Tests on a
   synthetic clump (skips dam/vlo; one wheel → 4 placements; marker → paint colour).

3. **Adapter + placement.** `loadVehicle` (resolve def + carcol colours, merge `vehicle.txd` + car txd,
   `buildVehicle`); bootstrap places admiral + camper near spawn on the parking lot under `streamingRoot`.
   **Browser acceptance:** two recognisable, painted, wheeled cars sit on the Ganton lot, clear of other
   objects; map/character unchanged.

## Decisions / open questions

- **Wheels now or with "dummy"?** Place static wheels at the 4 wheel dummies **now** (they're in the DFF and
  make the car recognisable); the broader **dummy** work (wheel rotation/steer, opening doors, lights, seats,
  the component framework) stays deferred. (If you wanted wheels deferred too, easy to drop.)
- **Paint:** apply primary/secondary via the `(60,255,0)`/`(255,0,175)` markers; 4-colour's 3rd/4th colours
  deferred (markers/usage TBD). Pick the **first** carcol combo per car for now (game randomises).
- **Static vs entity:** static under `streamingRoot` now (no physics); becomes a dynamic ECS entity when
  vehicle physics lands.
- **`handling.cfg`** parsed + stored only (no behaviour) this task — for the later physics phase.
- **Texture merge:** generic `vehicle.txd` + the car's `.txd` into one map (car DFF uses both).

## Out of scope (later, per user)

`dummy` component system (wheel spin/steer, doors, lights, seats, exhaust), `collision` (vehicle COL),
`physic` (driving/handling from `handling.cfg`), `vehicle_vlo` (LOD switching), `damage` (`_ok`/`_dam`),
full 4-colour paint, vehicle spawning/streaming/traffic, enter/exit.

---

**Since-fixed (2026-06-10): paint markers + interior modulate.** Found via a custom Mustang
`admiral.dff`
(white interior). (1) The real SA editable colours are **1=(60,255,0), 2=(255,0,175), 3=(
255,175,0),
4=(255,60,0)** — the 3rd/4th constants in `build-vehicle.ts` were wrong ((0,255,255)/(255,255,0); no real
DFF
uses those). (2) The "buildMaterial forces white when textured" caveat above bit harder than paint:
RW
**modulates texture × material colour**, and vehicle interiors are light textures × dark grey
colours —
`buildVehicleMaterial` now restores that modulate for non-marker textured materials (vehicle path
only).
(3) `resolveVehicleColours` defaults missing 3rd/4th combo colours to **palette[0] (black)**, like SA
does
for 2-colour `car`-section cars. See memory `vehicle-paint-markers`.

---

**Since-fixed (2026-06-17): both SA wheel conventions + 3-axle support.** Found via custom
`original-extend` petro re-exports. `build-vehicle.ts` originally only built wheels from the single
shared `wheel` atomic instanced at the `wheel_*_dummy` frames (scaled per front/rear, mirrored on the
right). Mod re-exports also use SA's **per-corner** convention — distinct `wheel_{l|r}{f|m|b}` atomics
placed at their own frames (different front/rear wheels). Now: (1) per-corner wheel atomics are detected
(`WHEEL_CORNER_RE`) and built by `addCornerWheels`, mirroring the left copies exactly like the shared
path (geometry is reused +X-facing across corners, so the left side faced inward without it), at
authored size (no wheel-scale); (2) per-corner wheels **take precedence** over a stray shared `wheel`
atomic some exporters leave in; (3) both paths handle the **middle axle** (`m`) of 3-axle trucks (only
the front axle steers). A missing/empty wheel rig left the car sunk (no suspension) and undriveable (no
force applied at the wheels). Real fixtures: `tests/dff/vehicle/petro-4wheels.dff` (per-corner) +
`petro-6wheels.dff` (3-axle + stray `wheel`). A "locked"/protected mod DFF (`yosemite`) that builds no
wheels is a separate, shelved issue — see [open-issues/locked-dff.md](../open-issues/locked-dff.md).
