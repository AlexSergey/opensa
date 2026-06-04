# Unlock all explicit geometry + instancing catalog

## Context

`gta.dat` now references the full retail map: ~54 IDEs (incl. generic `vegepart`, `multiobj`,
`dynamic`, `procobj`) and 52 IPL directives. With every IDE loaded, the catalog covers ~14k object
defs, and the text + binary-stream IPLs place **45,671** instances — **36,265** resolvable, non-LOD,
across **5,119 unique models**. The explicit trees/rocks/props the user wants are these instances;
they were missing only because the generic IDEs weren't in the catalog before.

The current renderer builds geometry **per instance** (`buildClump` in a `useMemo` per `<MapInstance>`),
which cannot scale to 36k objects (36k geometry uploads + draw calls). The fix is a **model catalog +
instancing**: build each unique model once and draw all its placements with `InstancedMesh`. Heavy
repeaters make this decisive — e.g. `telgrphpole02`×1362, `lamppost3`×1338, `veg_palm04`×871,
`new_bushsm`×1008 each become a single instanced draw call.

This plan covers (1) unlocking the explicit geometry and (2) the instancing catalog. **True
procedural `procobj` scatter** (procobj.dat + COL surfaces) is explicitly out of scope here.

### Findings
- `IMG IMG\gta3` is back in `gta.dat`, so `imgDirs[0]` → `img/gta3` resolves models again.
- 52 IPL directives: 30 have `inst` data; 20 are zones/paths/cull/occlu/audiozon (no `inst`).
- 36,265 resolvable non-LOD instances / 5,119 unique models (full San Andreas).
- Binary INST already carries `interior` — most world geometry is `interior == 0`.

## Part 1 — Unlock explicit geometry (walker)

Mostly already works once all IDEs load; the gaps:

- **Model folder**: keep `imgDir = imgDirs[0]` (now `img/gta3`), but add a constant fallback
  `DEFAULT_IMG_DIR = 'img/gta3'` so resolution doesn't depend on DAT ordering.
- **Non-placement IPLs**: `parseIpl` already returns `[]` for `.ZON`/paths/cull/etc. (no `inst`),
  so they're harmless. Binary-stream probing for those basenames yields one 404 each — acceptable
  (≤20). Optionally short-circuit a small denylist (`map`, `info`, `paths*`, `cull`, `tunnels`,
  `occlu*`, `audiozon`) to avoid the noise.
- **Volume controls (recommended defaults)** — the full map is ~36k instances and ~5k unique DFF
  fetches (network-heavy). Add optional, cheap filters in the walker/scene:
  - `interior === 0` (exterior world only) — drops interior props floating at interior coords.
  - optional region prefixes (e.g. only `la*`) to scope what loads while iterating.
  Default: exterior-only; region filter off (full map) but documented as the volume knob.

## Part 2 — Instancing catalog (core)

### `buildClumpParts` (new, in `src/renderware/three/`)
Add a sibling to `buildClump` that returns **flat, single-material render parts** instead of a Group:

```ts
interface RenderPart { geometry: BufferGeometry; material: Material; matrix: Matrix4; }
buildClumpParts(clump, textures?, { convertToYUp }): RenderPart[]
```

- Reuse the existing geometry/material build, but emit **one geometry per material group** (split the
  per-material index range into its own indexed `BufferGeometry` sharing the position/uv/normal/color
  attributes) so each part has a single material — `InstancedMesh` requires one material, no groups.
- `matrix` = the atomic's frame transform (what `buildClump` applies via `applyMatrix4`).
- `convertToYUp` stays `false` for the map; the scene root still applies the single −90°X.
- Refactor `buildClump` to compose from `buildClumpParts` (build parts → meshes) to avoid duplication
  and keep the single-model demo/tests working.

### Model prototype cache + instances (`src/map/`)
- `model-key.ts`: `modelKey(def)` = `${modelName}|${txdName}` (lowercased). Instances with the same
  key share geometry + material.
- `use-model-parts.ts`: `useModelParts(base, imgDir, def)` → `useLoader(TXDLoader)` + `useClump`,
  then `buildClumpParts(clump, textures, { convertToYUp:false })`, memoized per key. (Same race-free
  pattern as today: stateless TXD loader + cached clump.)
- `model-instances.tsx`: `<ModelInstances def instances base imgDir>` —
  - `const parts = useModelParts(...)`.
  - For each part render `<instancedMesh args={[part.geometry, part.material, instances.length]}>` and
    fill the matrices: `instanceMatrix[i] = placementMatrix(instance_i) × part.matrix`, where
    `placementMatrix` composes the GTA Z-up `position` + `rotation` quaternion (scale 1). Set
    `instanceMatrix.needsUpdate = true`; call `computeBoundingSphere()` for culling.
- `map-scene.tsx`:
  - Build `resolvable` (catalog def + model file + non-LOD, optionally `interior===0`).
  - **Group** by `modelKey` → `Map<key, { def, instances[] }>`.
  - Render one `<Suspense><ModelInstances …/></Suspense>` per group inside the `[-π/2,0,0]` root.
  - `FitCamera` unchanged (still `focus`-able on Ganton).
- Retire the per-instance `MapInstance`/`useMemo(buildClump)` path (or keep it only for single
  non-instanced use).

Result: ~5,119 instanced models instead of 36k Groups; CPU build + GPU geometry collapse to
per-unique-model, and high-count models draw in one call each.

## Tests (vitest)

- `build-clump-parts.test.ts`: from a synthetic 2-material clump assert N parts, each geometry
  single-material (one group / correct index count), correct local matrix; `buildClump` still
  produces the same visible result (parts compose back).
- `model-key.test.ts`: key normalization/casing.
- Instance-matrix composition: a small pure helper test (placement ∘ frame for a known pos/quat).
- Existing parser/loader suites stay green.

## Verification

1. `npm run lint` + `npx tsc --noEmit` clean; `npm test` green.
2. End-to-end at Ganton: `serve:static` + `dev` → the neighbourhood is now populated with palms,
   bushes, lampposts, poles, fences etc. (vs the bare blocks before); no real console errors.
   Compare instance/draw-call counts (expect ≫ fewer draw calls than instances). Playwright snapshot.
3. Sanity: spot-check a heavy repeater (e.g. `veg_palm04`) renders once as an InstancedMesh with
   ~871 instances.

## Out of scope (separate milestones)

- **True procobj scatter** (`data/procobj.dat` + COL surface materials + scatter algorithm) — the
  small ground clutter (grass tufts, searocks). Tracked separately.
- COL collision, LOD cross-linking/transitions, dynamic-object physics, draw-distance culling,
  loading the whole map at once without region scoping (network), texture atlas/merge beyond
  instancing.
