# lod-generator

A separate, **custom** (non-lossless) tool that regenerates the map's distant LODs from the HD models. Unlike
`map-optimizer` (which conditions existing assets without changing what's authored), this **bakes new content**:
it cuts the world into square cells and, per cell, merges the HD geometry into **one decimated LOD mesh + one
texture atlas** — the modern open-world LOD scheme (cf. GTA V SLOD). Kept out of `map-optimizer` on purpose: it's
additive and opinionated.

It takes the same input as map-optimizer — a `game-src/<game>/` folder — processes it, and writes its own build.

## Usage

```bash
# from the repo root — <game> is a folder under game-src/ (e.g. original)
# Phase 0 (implemented): assemble the world into cells + print a sizing report.
npx tsx lod-generator/src/cli.ts --game original --cell 256
```

```
lod-generator original:  cellSize=256
  cells      — 520
  instances  — 30981 HD (5958 unique models)
  per cell   — up to 422 instances
```

Baking + emitting a drop-in build (cell DFFs / atlas TXDs / IPL, stripping the old LODs) lands across **plan
002**; today the CLI runs only the read-only Phase-0 measurement.

## Layout

```
lod-generator/
  src/
    cli.ts                 # --game entry (Phase 0 today)
    lod.config.ts          # cell size (must match the engine streaming grid) + budgets
    core/                  # game-agnostic: Cell/grid types, the LodAdapter contract, summary
    adapters/gta-sa/       # RenderWare adapter — reuses ../src parsers READ-ONLY; bake/writers live here
  docs/plans/              # 001 architecture, 002 chunked-LOD-atlas
  out/<game>/              # generated build (gitignored)
```

## Principles (same discipline as map-optimizer)

- **Never modify `../src`** — read-only reuse of the engine's IDE/IPL/DFF/TXD parsers; all writers live here.
- **Game-agnostic core + a per-game adapter** — a new game is a new adapter, no core change.
- **Engine fit, not engine change** — the engine already renders a per-cell HD/LOD grid, so generated cell-LODs
  drop in via config (cell size match), not code. See plan 002.
