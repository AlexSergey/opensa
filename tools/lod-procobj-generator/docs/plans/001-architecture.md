# 001 — lod-procobj-generator: architecture, extraction & task plan

**Plan only — no code yet.** Split procobj LOD generation out of `lod-trees-generator` into a dedicated tool whose
LODs are **simplified copies of the HD model** (decimated geometry, like `lod-generator`) — not crossed-billboard
impostors. Extract the shared bits into a reusable package, and strip procobj entirely from `lod-trees-generator`.

## Why a separate tool

`lod-trees-generator` bakes **impostors** (crossed cards + alpha atlas) — great for distant trees, wrong for
procobj clutter (bushes, rocks, joshua, scrub). Those read better as a **low-poly mesh** at the medium distances
procobj lives at. Two different LOD strategies → two tools. procobj placement (scatter → static IPL) is the same
machinery either way, so it moves to a shared package both can use.

| Tool                          | Input                     | LOD strategy                       | Placement                            |
| ----------------------------- | ------------------------- | ---------------------------------- | ------------------------------------ |
| `lod-trees-generator`         | tree HDs (`--dff/txd`)    | **impostor** (cards + atlas)       | attach to streamed/text HD instances |
| `lod-procobj-generator` (new) | procobj HDs (`--dff/txd`) | **simplified copy** (QEM decimate) | procobj scatter → static IPL         |
| `lod-generator` (existing)    | whole-map cells           | **simplified copy** (QEM decimate) | per-cell merged static IPL           |

## The new tool

### CLI

```
tsx tools/lod-procobj-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path>
  --dff   procobj HD DFF file or directory (the species to convert; intersected with procobj.dat)
  --txd   the HD models' TXD(s) — LOD textures are downscaled from here, falling back to the stock game TXD
  --out   output drop-in directory
  --game  game-data dir (gta.dat + data/ + models/gta3.img)
  --tris  decimation target triangles per LOD model (default from config)
  --tex   LOD texture max size px (default from config)
  --draw  LOD draw distance (default from config)
  --max   cap on converted procobj objects (0 disables)
  --height  optional min HD height (m) gate to drop short clutter
```

Same `--dff ∩ procobj` curation model as today: the user lists HD models; only those that are procobj species get
converted. No model-type heuristics in the tool.

### Pipeline (per species, then batch)

```
P0 Select   — parse procobj.dat ∩ --dff models → the species to convert (+ optional height gate)
P1 LOD mesh — per species: parse HD DFF (atomics+frames) → decimate (QEM) → rebuild normals → encode low-poly DFF
P2 LOD txd  — per species (or one shared): decode HD textures (--txd ∪ stock) → downscale → encode TXD
P3 Register — allocate object ids (≤18630), emit lod_procobj.ide, alias long names
P4 Place    — scatter (vanilla) → MINDIST cull → cap → emit static IPL (HD inst + its simplified-LOD inst)
P5 Swap     — swap procobj HD DFFs for --dff, retxd (only when the custom TXD covers the model)
P6 Strip    — remove converted species from procobj.dat
P7 Write    — repack gta3.img (+ LOD DFFs/TXD), data/maps/*.ipl + *.ide, patched gta.dat
```

P1–P2 are **lod-generator's mechanism applied to a single model** instead of a merged cell. P4/P6 are
`lod-trees-generator`'s procobj `convert.ts`/`world.ts`, but the LOD instance now points at a **simplified-copy
model id** instead of an impostor id.

### Core / adapter split

Mirror both existing tools: a game-agnostic `core/` (the species-LOD contract + decimation driver) and a
`adapters/gta-sa/` binding to RenderWare DFF/TXD + SA IPL/IDE/procobj. The new tool is mostly **orchestration** —
the heavy lifting lives in the shared packages below.

## LOD = simplified copy (reused from `lod-generator`)

`lod-generator` already does HD → low-poly: **QEM edge-collapse** (`@opensa/tool-kit/mesh/simplify`), smooth-normal
rebuild (`@opensa/tool-kit/mesh/smooth-normals`), then encode a one-atomic multi-material DFF + a downscaled
RGBA8888 TXD. Its per-cell pipeline is:

- `model-source.ts` — lazy `parseDff` + cache.
- `merge.ts` — accumulate instances into one mesh (the new tool merges a **single** model → trivial).
- `decimate.ts` — `simplify(mesh, targetTris)` with pinned material seams / boundaries.
- `normals.ts` — `rebuildSmoothNormals` + vertex splits.
- `dff.ts` — `encodeCellDff(mesh, name)` → DFF bytes (`@opensa/rw-codec`).
- `cell-txd.ts` — iterative 2× box downscale (`@opensa/rw-codec/mip`) → `encodeCellTxd`.
- `texture-source.ts` — lazy TXD decode.

For the new tool the granularity changes (per **species** model, not per **cell**), but the transforms are
identical. So these modules are the extraction target (see below) — the new tool feeds one HD model through them
and gets a `lod<species>.dff` + its textures.

**Frame transform note:** `lod-generator`'s `merge.ts` already applies the DFF frame transform — same fix
`lod-trees-generator` just got (bug 3). Confirm it bakes atomics×frames; reuse as-is.

## procobj placement (reused from `lod-trees-generator`)

`procobj/convert.ts` + `procobj/world.ts` already: reuse the engine's vanilla `scatterProcObjects`, thin by MINDIST
min-spacing + a global cap, emit `lodtrees_procobj.ipl` (HD inst + LOD inst with a text-internal `lod` link), strip
converted species from `procobj.dat`, and return the `gta.dat` IPL line. The **only** change for the new tool: the
LOD instance references the **simplified-copy** model (id/name from P3) instead of an impostor alias. The
`ProcObjSpecies` record's `impostorId/impostorAlias` become a generic `lodId/lodModel`.

## Reuse analysis & extraction

### Keep `@opensa/tool-kit` as-is (pure, game-agnostic)

`mesh/simplify`, `mesh/smooth-normals`, `archive/img` — already shared by `lod-generator`,
`lod-trees-generator`, `map-optimizer`. Both LOD tools keep using it. **Do not** add SA-format knowledge here.

### Two new packages (chosen): `@opensa/map-placement` + `@opensa/sa-lod`

`tool-kit` stays generic. The shared SA code splits by concern into two packages — placement (map-file workflows)
vs lod (mesh simplification + encode):

```
tools/map-placement/src/        ← extracted from lod-trees-generator/place + strip + (old) procobj
  ids.ts                        allocateLodIds (≤18630, non-contiguous) + alias + IDE objs builder
  gta-dat.ts                    patchGtaDat (splice IDE/IPL lines)
  ipl-text.ts                   applyTextEdits (append / repoint / setLod) + stripTextIpl
  ipl-binary.ts                 linkBinaryLods + stripBinaryIpl
  retxd.ts                      editIdeTxd + retxdSwappedModels + selectTxd (coverage-gated)
  procobj/
    convert.ts                  scatter → static IPL (generalised: lodId/lodModel, not impostor-specific)
    world.ts                    buildMapDefinitions (catalog + instances for the engine)
    strip.ts                    stripProcObj + UNDERWATER_PROCOBJ never-touch constant
  package.json                  exports "./ids", "./gta-dat", "./ipl-text", "./ipl-binary", "./retxd", "./procobj"

tools/sa-lod/src/               ← extracted from lod-generator adapter
  model-source.ts               lazy parseDff cache
  decimate.ts                   QEM driver (wraps tool-kit/simplify)
  normals.ts                    smooth-normal rebuild (wraps tool-kit/smooth-normals)
  encode-dff.ts                 mesh → one-atomic multi-material DFF (rw-codec)
  texture-source.ts             lazy TXD decode (--txd ∪ stock fallback)
  encode-txd.ts                 downscale + encode TXD (rw-codec/mip + texture-native)
  mesh.ts                       MergedMesh / MergedGroup types + a single-model accumulator
  package.json                  exports "./mesh", "./decimate", "./normals", "./encode-dff", "./encode-txd", "./sources"
```

Layering: `rw-codec` (bytes) → `renderware` (read) → **`map-placement`** / **`sa-lod`** (SA write workflows) →
tools (CLI). Both sit beside `tool-kit` (generic) and `rw-codec` under `tools/`.

### What moves where

| Source (today)                                                                                       | Destination                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `lod-trees-generator/place/ide.ts` (alloc/alias/dat/IDE)                                             | `map-placement/ids.ts` + `gta-dat.ts`            |
| `lod-trees-generator/place/ipl-text-append.ts` + `strip/ipl-text.ts`                                 | `map-placement/ipl-text.ts`                      |
| `lod-trees-generator/place/ipl-binary-link.ts` + `strip/ipl-binary.ts`                               | `map-placement/ipl-binary.ts`                    |
| `lod-trees-generator/place/retxd.ts`                                                                 | `map-placement/retxd.ts`                         |
| _(removed)_ `lod-trees-generator/procobj/{convert,world}.ts` (git history)                           | `map-placement/procobj/*` (rebuilt, generalised) |
| `lod-trees-generator/strip/procobj.ts` (+ `UNDERWATER_PROCOBJ`)                                      | `map-placement/procobj/strip.ts`                 |
| `lod-generator/adapters/gta-sa/{model-source,decimate,normals,dff,texture-source,cell-txd,merge}.ts` | `sa-lod/*`                                       |

After extraction, `lod-trees-generator`, `lod-generator`, and the new tool import from `map-placement` / `sa-lod`
(+ `tool-kit`). Their adapters become thin. (Phase 1 already removed procobj from `lod-trees-generator`; its
`convert.ts`/`world.ts` are recovered from git history when building `map-placement/procobj`.)

## Strip procobj from `lod-trees-generator`

**Done (Phase 1).** `lod-trees-generator` is back to **impostors only**:

- Removed `src/adapters/gta-sa/procobj/` (`convert.ts`, `world.ts`, `convert.test.ts`).
- Removed `--procobj` / `--procobj-max` / `--procobj-height` flags (`cli.ts`), `procObjHeight`/`procObjMax`
  (`config.ts`, `core/types.ts`), the `convertProcObj` call + `procObjSpecies` + the `procobj ?…` swap filter (back
  to "swap LOD'd non-procobj") in `place-map.ts`, and the `procobj` plumbing in `index.ts`. `ImpostorRef.height`
  (a procobj-only gate) dropped too.
- **Kept** `procObjModels(gamePath)` in `place-map.ts` — still needed to keep procobj species' HD **stock** (not
  swapped).
- **Kept** `strip/procobj.ts` for `--strip` (verification "empty world" still clears tree scatter), and added a
  hard never-touch constant **`UNDERWATER_PROCOBJ`** (seaweed/starfish/searock01–06): these are never stripped (and
  by the same constant must never be converted by the new tool). Shared debris like `p_rubble*` is **not** in it
  (it also scatters on land).
- Docs updated: deleted `006-procobj-place.md`; `004`/`007 §C`/`readme`/`003` de-procobj'd + pointed at this tool.

Note: the **memory** `ipl-lod-index-coupling` and `sa-generated-asset-format` stay valid (shared formats).

## Task plan (phases)

1. **Cleanup** — strip procobj from `lod-trees-generator` (+ docs). ✅ **Done.**
2. **Scaffold `@opensa/map-placement`** ✅ **Done.** Created the package (workspaces + symlink + vitest glob +
   `exports`); moved the **shared** modules only — `ide.ts` (generalised: `allocateLodIds` / `buildLodIde(txd…)` /
   `lodAlias` / `patchGtaDat`), `retxd.ts`, `procobj-strip.ts` (with `UNDERWATER_PROCOBJ`). `lod-trees-generator`
   imports them back, green. The IPL **append/strip** modules (`ipl-text-append`, `ipl-binary-link`,
   `strip/ipl-*`) stayed in `lod-trees-generator` — they're impostor/strip-specific, not shared.
3. **Scaffold `@opensa/sa-lod`** ✅ **Done.** Created the package; moved `decimate`/`normals`/`encode-dff` (was
   `dff`)/`encode-txd` (was `cell-txd`)/`model-source`/`texture-source` from `lod-generator` + a new `mesh.ts`
   (the `MergedMesh`/`MergedGroup` **types** only). `lod-generator` repointed (core/types, core/index, merge,
   adapter, finalize), green. `merge.ts`/`MeshBuilder` stayed in `lod-generator` (cell-specific) — the new tool
   writes its own frame-aware single-model builder. Encoders renamed `encodeLodDff`/`encodeLodTxd`; model/texture
   sources now take `ImgArchive[]`. Added both new packages to the eslint Node-globals override.
4. **Rebuild + generalise `procobj/convert` + `world`** ✅ **Done.** Recovered both from git's dangling blobs into
   `map-placement/src/procobj/`; `convert` generalised — `ProcObjSpecies` now `{ hdId, height, lodId, lodModel }`,
   the IPL name is an `iplName` option (`lod_procobj`), and `UNDERWATER_PROCOBJ` species are never converted.
   Exported as `@opensa/map-placement/procobj`. `world.ts` was already generic (moved as-is). Tests recovered.
5. **Build `lod-procobj-generator`** ✅ **Done.** `src/cli.ts` + `config.ts` + `mesh-builder.ts` (frame-aware
   single-model → `MergedMesh` + `meshBounds`) + `build.ts` (the P0–P7 orchestrator). Wires `map-placement`
   (`convertProcObj`/`allocateLodIds`/`buildLodIde`/`lodAlias`/`patchGtaDat`/`retxdSwappedModels`) × `sa-lod`
   (`decimateMesh`/`rebuildMeshNormals`/`encodeLodDff`/`encodeLodTxd`/`encodeColLibrary`/model+texture sources) ×
   `tool-kit` (`editArchive`). One shared `lod_procobj.txd` (`--txd ∪ stock`, downscaled) + `lod_procobj.col`
   (empty-collision per LOD). Mesh-builder unit-tested.
6. **In-game verify** — _pending the user_: convert a handful of species, check the simplified LODs render + fade,
   CPool budget.

Each phase keeps `tsc`/`eslint`/tests green; extraction phases were move-then-reimport (no behaviour change).

## Decisions (resolved)

1. **Shared package shape** — **two** packages: `@opensa/map-placement` + `@opensa/sa-lod` (`tool-kit` stays generic).
2. **`--strip` procobj in `lod-trees-generator`** — **keep** the local clear, but **never touch** the
   `UNDERWATER_PROCOBJ` species.
3. **Cleanup timing** — **done** (Phase 1), ahead of the package work.
4. **LOD TXD** — **one shared `lod_procobj.txd`** (name-prefixed entries, fewer IMG entries).
5. **New tool name** — **`lod-procobj-generator`**.
