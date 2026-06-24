# 001 — lod-generator architecture

**Status: ✅ Base scaffolded (Phase 0 runs).** A standalone subproject that regenerates the map's LODs from the
HD models, kept separate from `map-optimizer` because LOD baking is **additive and custom**, not lossless
conditioning. Mirrors map-optimizer's proven shape: a game-agnostic core + a per-game adapter, reusing the
engine's parsers read-only.

## Why a separate project

`map-optimizer` is **lossless** — it conditions existing assets (normals, prelit, dedupe) without changing what
the map authors placed. LOD generation is the opposite: it **invents new geometry + textures** (merged,
decimated, atlased per cell) and rewrites IPL. Mixing the two would muddy map-optimizer's "safe to run on any
map" contract, so this lives on its own with its own `out/`.

## Shape (mirrors map-optimizer)

```
cli.ts  --game <name>  →  game-src/<name>/  →  out/<name>/
  core/        game-agnostic: Cell + grid, the LodAdapter contract, the Phase-0 summary
  adapters/    per-game I/O behind LodAdapter; gta-sa reuses ../src parsers READ-ONLY
  lod.config   cell size (MUST equal the engine streaming cellSize) + (later) decimation/atlas budgets
```

**`LodAdapter`** (the whole per-game surface):

- `resolveCells()` — assemble the exterior HD instances into the square cell grid. **Implemented** (Phase 0):
  reuses `ideRefs` + `parseIpl` / `parseBinaryIpl` + `isLodModel` from `../src` to bucket instances by world
  position, dropping interiors and old `lod*` models.
- `bakeCell(cell)` — merge → QEM decimate → texture atlas → one LOD mesh per cell. **Stubbed** → plan 002
  Phases 1–2.
- `finalize(outDir, baked)` — emit cell DFFs / atlas TXDs / IPL, strip old LODs. **Stubbed** → plan 002 Phase 3.

## Principles

- **Never modify `../src`** — read-only reuse of the engine's parsers; every writer lives in lod-generator
  (same rule that keeps map-optimizer self-contained).
- **Game-agnostic core, per-game adapter** — RenderWare/GTA-SA specifics stay in `adapters/gta-sa`.
- **Engine fit, not change** — the engine already streams a per-cell HD/LOD grid (`world-grid.ts` /
  `build-cell.ts` / `streaming.system.ts`), so generated cell-LODs render via config (cell-size match), not a
  `../src` change. (Details + the LOD bake pipeline: plan 002.)
- **Reuse map-optimizer's writers where they fit** — the DXT encoder + VER2 archive writer (its plans 010/011)
  and smooth-group normals (its plan 015) are the natural building blocks for the atlas TXD + cell DFFs.

## Phase 0 — done

`adapters/gta-sa/resolve.ts` + the CLI assemble `original` into the grid and report sizing
(`cellSize`, cells, HD instances, unique models, max instances/cell). This validates the read path and gives
real numbers to pick the cell size + budgets from, before any baking exists.

## Status of the build pipeline

`bakeCell` / `finalize` throw until plan 002 lands them, so the CLI can't silently emit an empty build. The
phased bake (measure → geometry LOD → atlas → integrate) is plan 002.
