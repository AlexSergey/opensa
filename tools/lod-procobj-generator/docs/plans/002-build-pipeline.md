# 002 — build pipeline (procobj HD → simplified-copy LODs)

**Status: ✅ Done (as-built).** Documents the actual `run()` in `src/build.ts` (orchestrator) + `src/mesh-builder.ts`
(the frame-aware single-model mesh) + `src/config.ts` (knobs). Architecture/extraction rationale is in
[001](./001-architecture.md); the strict-SA format gotchas in [003](./003-sa-asset-format.md).

The tool is a thin orchestrator: the mesh simplification + encoders come from **`@opensa/sa-lod`** and the map-edit
workflows (scatter→IPL, id allocation, gta.dat/IDE edits, retxd) from **`@opensa/map-placement`**. `build.ts` only
wires them and owns the procobj-specific mesh builder.

## Inputs / config

CLI (`cli.ts` → `run({ config, dffPath, gamePath, outPath, txdPath })`):

- `--dff` HD DFF file or directory · `--txd` HD TXD(s) · `--out` drop-in dir · `--game` game-data dir.
- Knobs (`config.ts`, all overridable): `--tris` (200, QEM target), `--tex` (64 px, LOD texture max), `--draw`
  (300, LOD draw distance), `--max` (20000, static-object cap; `0` disables conversion), `--height` (0 = off, min
  HD height gate).

## Stages (as built in `run()`)

### S0 — Select species

- `openArchive(gta3.img)`, `parseGtaDat(gta.dat)`.
- `scanIdes(gamePath, dat.ide)` walks **every IDE the gta.dat lists** (`parseIde` + `parseTimedObjects`) →
  `idByModel` (model→object id) + `usedIds` (every occupied id).
- `procObjModels(gamePath)` = column 2 of each `procobj.dat` data row (the scatter species).
- **Species = `listDffModels(--dff) ∩ procObjModels ∩ has-an-id`.** Same `--dff ∩ procobj` curation as
  `lod-trees-generator`: the user lists HD models; only those that actually scatter in procobj and have a stock
  object id are converted. No model-type heuristics. (`UNDERWATER_PROCOBJ` species are dropped later by
  `convertProcObj` — never converted.)

### S1 — LOD mesh (per species)

For each species, **pass 1** (`BuiltMesh`):

- `modelSource.load(model)` → `RWClump` (lazy `parseDff` + cache, `@opensa/sa-lod/model-source`).
- `buildModelMesh(clump)` (`mesh-builder.ts`) → a **model-local** `MergedMesh`: iterate atomics, place each
  geometry by its **frame transform** (right/up/at basis + translation) so multi-atomic / frame-offset models
  assemble correctly (the engine + `lod-trees-generator` bake the same way). Triangles bucket by texture name;
  prelit defaults to opaque white; the instance's world placement is applied later by the IPL `inst`.
- `meshBounds` → AABB; `height = max.z − min.z`. **Height gate:** if `--height > 0` and `height < --height`, skip
  (short clutter like grass stays on the runtime scatter).
- `rebuildMeshNormals(decimateMesh(raw, --tris))` — QEM edge-collapse (`@opensa/sa-lod/decimate`) then smooth-normal
  rebuild (`@opensa/sa-lod/normals`). Collect the distinct non-empty `group.texture` names.

If no species survive → log + return (no output written).

### S2 — Register ids + encode DFFs (pass 2)

- `lodAlias('lod' + model, i, 'lpo')` per species — the LOD model name (falls back to `lpo<i>` when the name would
  exceed the 19-char IMG-entry budget).
- `allocateLodIds(aliases, usedIds)` — the lowest free ids in the **≤ 18630** window (see [003](./003-sa-asset-format.md)).
- `encodeLodDff(mesh, alias)` (`@opensa/sa-lod/encode-dff`) → one-atomic multi-material low-poly DFF bytes.

### S3 — Shared LOD assets

- **`lod_procobj.txd`** — `encodeLodTxd(allTextures, textureSource, --tex)`: every used texture, 2× box-downscaled
  to ≤ `--tex`. `textureSource` is `--txd` first, then the stock game TXDs (`combinedTextureSource`).
- **`lod_procobj.col`** — `encodeColLibrary(bboxes, aliases)`: one **bounds-only** COL3 model per LOD (SA binds
  collision by model name).
- **`lod_procobj.ide`** — `buildLodIde(alias→id, 'lod_procobj', --draw)`: an `objs` section, one row per LOD.

### S4 — Place (scatter → static IPL) + strip

`convertProcObj({ archive, gamePath, heightThreshold, iplName: 'lod_procobj', outPath, procObjMax, species })`
(`@opensa/map-placement/procobj`): reuses the engine's vanilla procobj scatter, thins by MINDIST min-spacing + the
`--max` cap, emits the static IPL (each HD `inst` → its **simplified-copy LOD** `inst`, linked by a text-internal
`lod` index), and **strips the converted species from `procobj.dat`**. `ProcObjSpecies` here is
`{ hdId, height, lodId, lodModel }` (the generalised, non-impostor record). Returns `{ datLine, objects }`.

### S5 — Swap HD + retxd

- `swapEntries(--dff, models)` — the user's HD DFF bytes, keyed `<model>.dff` (so the converted species ship the
  modder's HD model, not the stock one).
- `retxdSwappedModels(gamePath, dat.ide, --dff, --txd, models)` (`@opensa/map-placement/retxd`) — coverage-gated
  custom TXD swap: rewrites the HD models' IDE `txd` + packs the custom TXDs **only when `--txd` covers the model**.

### S6 — Emit the drop-in (`--out`)

- Text: `lod_procobj.ide`, the retxd IDEs, and `gta.dat` = `patchGtaDat(stock, DATA\MAPS\LOD_PROCOBJ.IDE)` with the
  `convertProcObj` IPL `datLine` appended.
- `gta3.img` (`editArchive(archive)`): set each `<alias>.dff`, `lod_procobj.txd`, `lod_procobj.col`, the swapped HD
  DFFs, and the custom TXDs → `build()`.
- Report: `procobj→lod: N species · M static objects · K HD swapped (J custom TXD) → <out>`.

## Reused vs owned

| Concern                                                        | From                                     |
| -------------------------------------------------------------- | ---------------------------------------- |
| parse DFF/TXD/IDE/gta.dat, IMG                                 | `@opensa/renderware`, `@opensa/rw-codec` |
| decimate / normals / encode DFF/TXD/COL, model+texture sources | `@opensa/sa-lod`                         |
| scatter→IPL + procobj strip, id alloc / IDE / gta.dat / retxd  | `@opensa/map-placement`                  |
| editable IMG                                                   | `@opensa/tool-kit/archive/img`           |
| **frame-aware single-model mesh + bounds**                     | **this tool** (`mesh-builder.ts`)        |

## Tests

`mesh-builder.test.ts` unit-covers `buildModelMesh` (texture bucketing + model-local positions under the identity
frame) + `meshBounds`. The shared encoders/placement carry their own tests in `sa-lod` / `map-placement`. The
full `run()` is exercised manually against real game data (the in-game verify below).

## Follow-up

In-game verify (task-plan phase 6): convert a handful of species, confirm the simplified LODs render + fade at
`--draw`, and check the CPool/static-object budget against `--max`.
