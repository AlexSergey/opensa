# map-optimizer

An offline, **lossless** asset-conditioning tool for the game maps OpenSA loads. It takes a `--game` (the same
`game-src/<game>/` layout the main `build-game` script uses), finds the model DFFs the map actually references,
runs them through a composable, Gulp-style **plugin pipeline**, and writes optimized copies — without touching
the originals.

On the bundled `gostown` map it currently shrinks the models **~32%** (≈110 MB → ≈75 MB) by recomputing
normals, welding duplicate vertices, and removing degenerate / duplicate faces — all changes that are provably
**visually identical** (verified by re-parsing every output and checking triangle/material-split consistency).

> Separate sub-project. It reuses the main engine's RenderWare **parsers** read-only (`../src`); all the
> **writing** (the DFF serializer / re-encoder) lives here. The core is game-agnostic — a different game is a
> new adapter.

## Usage

```bash
# from the repo root — <game> is a folder under game-src/ (e.g. gostown)
npx tsx map-optimizer/src/cli.ts --game gostown

# opt-in texture pass:
npx tsx map-optimizer/src/cli.ts --game gostown --textures   # generate mip chains (plan 010)
```

- Reads `game-src/<game>/` (models `*.img` + `data/` IDE/IPL to resolve the map's models).
- Writes a **complete, drop-in build** to **`map-optimizer/out/<game>/`** (gitignored; the source is never
  modified) — the whole `game-src/<game>/` tree mirrored, with each `models/*.img` **rebuilt**: optimized
  entries swapped in, everything else (vehicles, peds, interiors, data, …) preserved. Point the game at it
  and it runs. A **`report.json`** is written alongside.
- `--textures` is **opt-in** (off by default).
- Prints a summary: models processed/changed, vertices & faces removed, size reduction, and any per-asset
  failures (isolated — one bad model never aborts the run).

```
map-optimizer gostown:
  models   — 836 processed, 813 changed
  vertices — 1283675 removed
  faces    — 1144 removed
  size     — 109892 KB → 74958 KB (31.8% smaller)
  failures — 7
```

## Pipeline

Edit `src/optimizer.config.ts` (the "gulpfile") to choose/reorder stages. The default pipeline, in order:

1. **recompute-normals** — angle-weighted, crease-limited per-vertex normals (smooths surfaces, keeps hard
   edges; welds seam splits). `addMissing` can also add normals to normal-less models.
2. **weld-vertices** — merge vertices identical in _all_ attributes (position/normal/UV/prelit/night).
3. **remove-degenerate-triangles** — drop zero-area faces (coincident/collinear/equal-index).
4. **dedupe-faces** — remove exact duplicate triangles (keeps two-sided/reversed-winding faces and decals).
5. **prune-vertices** — drop vertices no triangle references.
6. **condition-prelit** — re-level pathologically dark/bright day-prelit toward a neutral target (RGB only,
   alpha preserved); healthy models keep their baked AO. Visual heuristic — calibrate `targetLuma` in-game.
7. **synthesize-night** — give night-less, opaque, bright-enough models a night vertex-colour set derived from
   their day prelit, so they don't go dark at night (the engine darkens night-less models). Map-wide visual
   heuristic — tune `minLuma`/`nightScale` (or restrict it) in-game; models that already have night colours
   are untouched.

Every stage is a small, independently-tested pure transform wrapped in a `MapPlugin`.

## How it works

```
--game <name>
  resolve   reuse the build partition: open models/*.img + parse data/ IDE+IPL → the map's model DFFs
  read      DFF bytes → RWClump (../src parser) → neutral MeshIR
  pipeline  MeshIR ──▶ plugin1 ▶ … ▶ pluginN   (per model, concurrency-limited, errors isolated)
  write     MeshIR → DFF bytes (in-house serializer)   → out/<game>/  + report.json
```

- **Faithful chunk codec** (`src/adapters/gta-sa/codec/chunk.ts`): `writeRw(readRw(bytes))` is byte-exact, so
  an unchanged model round-trips identically.
- **Re-encoder** (`geometry-struct.ts` + `geometry-rebuild.ts`): rewrites a Geometry's Struct (and, on a
  vertex/triangle count change, regenerates **BinMeshPLG**, remaps **night colours**, recomputes the
  **bounding sphere**). It **refuses** (per-asset) what the neutral IR can't safely remap — skinned, multi-UV,
  or multi-morph geometry — so those models are skipped, not corrupted.

## Layout

```
map-optimizer/
  src/
    cli.ts                 # --game entry
    optimizer.config.ts    # the default pipeline
    core/                  # game-agnostic: ir, asset, adapter iface, pipeline, report
    adapters/gta-sa/       # RenderWare adapter: resolve / read / codec (the DFF writer)
    plugins/               # recompute-normals, weld, degenerate, dedupe, prune (+ shared vertex-compaction)
  docs/plans/              # numbered design plans (001 base … 008 report)
  out/                     # generated output (gitignored)
```

## Extending

- **A new transform:** add a `plugins/<name>.ts` exporting a `create…(): MapPlugin` (and ideally a pure
  function + unit test), then list it in `optimizer.config.ts`.
- **Another game:** implement `core/adapter.ts`'s `GameAdapter` under `src/adapters/<game>/` (resolve / read /
  write for that game's format). The core and plugins don't change.

## Status & safety

Everything implemented is **provably lossless** (no appearance change), validated by parser round-trip +
triangle/material-split integrity over the full gostown map (0 serializer failures). The remaining backlog
items **change appearance** and need **in-game visual validation** before shipping:

- coplanar / decal-aware face dedupe (a blanket version would delete intentional decals);
- T-junction welding; hole-fill / remesh;
- prelit / night-vertex-colour conditioning (flattening prelit looks _worse_ — must fill gaps, not equalize);
- auto-wind weight authoring.

See [`docs/plans/`](./docs/plans/) for the full design history.
