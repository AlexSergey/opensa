# opensa-lod-generator

A separate, **custom** (non-lossless) tool that regenerates the map's distant LODs from the HD models. Unlike
`map-optimizer` (which conditions existing assets without changing what's authored), this **bakes new content**:
it cuts the world into square cells and, per cell, merges the HD geometry into **one decimated LOD mesh + one
texture atlas** — the modern open-world LOD scheme (cf. GTA V SLOD). Kept out of `map-optimizer` on purpose: it's
additive and opinionated.

It takes a game-data folder — `gta.dat` + `data/` + `models/` (e.g. `game-src/original/`) — processes it, and
writes its own build.

> **OpenSA only.** This tool targets OpenSA's engine, not the original game. The output is standard RenderWare so
> it loads in stock SA too, but the per-cell budget isn't tuned for SA's streamer (uncapped materials/size crash
> real SA on stream-in — OpenSA has no such limits). See the `opensa-lod-generator-decimation` memory for the real-SA
> findings if that support is ever revisited.

## Usage

```bash
# from the repo root — --game is a path to the game data (e.g. ./game-src/original)
# assemble the world into cells + print a sizing report (Phase 0):
npx tsx opensa-lod-generator/src/cli.ts --game ./game-src/original --cell 256

# bake every cell (merge → QEM decimate → smooth normals → per-cell DFF/TXD) and emit a drop-in build under
# --out (models/lods.img + data/lods.ide/.ipl + gta.dat lines):
npx tsx opensa-lod-generator/src/cli.ts --game ./game-src/original --out ./build
```

- `--game <path>` — path to the game data (`gta.dat` + `data/` + `models/`).
- `--cell <size>` — cell size in world units (must match the engine streaming grid; default from `lod.config.ts`).
- `--out <path>` — output directory for the baked drop-in. **Omit it to only print the sizing report** (Phase 0).
- `--strip-lods` — after building, remove the stock `lod*` building LODs from the drop-in (the cell-LODs replace
  that far-LOD layer): drops their IPL instances (text + binary streams, repairing the shared `lod`-index space)
  and deletes their `.dff`/`.txd` from `gta3.img`. The cell-LOD assets (`lods.*`) are left untouched. Use it so the
  stock far-LODs don't double up with the cell-LODs (both are `lod*`-named → both bucket into OpenSA's LOD ring).

```
opensa-lod-generator original:  cellSize=256
  cells      — 520
  instances  — 30981 HD (5958 unique models)
  per cell   — up to 422 instances
```

With `--out` it bakes the cells and emits a drop-in build (one `lods.img` of cell DFFs + per-cell TXDs + a shared
`lods.col` of bounds-only collision so SA can stream them, plus `lods.ide` / `lods.ipl`, registered in `gta.dat`).
Stripping the old `lod*` models is done via `--strip-lods` (**plan 002**, 1d-iii); the cell TXDs are DXT-compressed
(DXT1/DXT5 + mips), keeping `lods.img` to ~196 MB instead of ~458 MB raw.

> **Needs an extended model-ID limit.** Cell-LOD ids start at `max IDE id + 1`, so the full map's cells run past
> the stock **≤ 18630** ceiling. Run the build with **fastman92 Limit Adjuster** ("model special features", IDs
> `0–19999`) or the game faults / crashes registering them.

> **Targets OpenSA, not the original game.** Output is standard RenderWare so it loads in stock SA too, but the
> per-cell budget isn't tuned for SA's streamer — uncapped cell-LODs (hundreds of materials, MB-scale models) crash
> real SA on stream-in (OpenSA has no such limits). The original-game caps were removed; see the
> `opensa-lod-generator-decimation` memory if SA support is revisited.

**Decimation:** each cell is merged then QEM-decimated **as one mesh** (not per model) to `lodCellRatio` (0.2) of
its triangles, floored at `lodCellMinTris` (1000) so sparse terrain isn't over-thinned. Two guards keep the far
view clean — an edge-length cap (no flat-surface spikes) and a per-texture-group floor (no vanishing surfaces);
vertices are **not** welded (welding smears textures / collapses stacked terrain). The DFF is emitted **two-sided**
(OpenSA back-face culling would otherwise hole SA's inconsistently-wound ground) and **split across multiple
atomics** when a cell exceeds the 65 535-vertex DFF limit. See plan 002 (Phase 1c/1d-i) and the
`opensa-lod-generator-decimation` memory for the tuning history + the open flat-island-erosion issue.

**What's baked:** exterior building/terrain instances only. **Trees** (the `@opensa/map-placement/vegetation`
roster) are excluded — they get billboard impostors from [`lod-trees-generator`](../lod-trees-generator/), and
decimated alpha foliage looks bad / would duplicate those. **procobj** scatter is never seen here (it lives in
`procobj.dat`, not the IPLs) — its LODs come from [`lod-procobj-generator`](../lod-procobj-generator/). Interiors
and the stock `lod*` models are dropped too.

## Layout

```
opensa-lod-generator/
  src/
    cli.ts                 # --game (Phase 0 report) / --out (full bake) / --strip-lods
    lod.config.ts          # cell size (= engine streaming grid) + decimation budget (cell ratio + min tris)
    core/                  # game-agnostic: Cell/grid types, the LodAdapter contract, summary
    adapters/gta-sa/       # RenderWare adapter — reuses ../src parsers READ-ONLY; bake/writers live here
  docs/plans/              # 001 architecture, 002 chunked-LOD-atlas
# baked drop-in is written wherever --out points (gitignored)
```

## Principles (same discipline as map-optimizer)

- **Never modify `../src`** — read-only reuse of the engine's IDE/IPL/DFF/TXD parsers; all writers live here.
- **Game-agnostic core + a per-game adapter** — a new game is a new adapter, no core change.
- **Engine fit, not engine change** — the engine already renders a per-cell HD/LOD grid, so generated cell-LODs
  drop in via config (cell size match), not code. See plan 002.
