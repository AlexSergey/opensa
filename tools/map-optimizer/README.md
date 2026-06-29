# map-optimizer

An offline, **lossless** asset-conditioning tool for the game maps OpenSA loads. It takes a `--game <path>` (a
game-data dir: `gta.dat` + `data/` + `models/`), finds the model DFFs the map actually references, runs them
through a composable, Gulp-style **plugin pipeline**, and writes optimized copies to `--out <path>` — without
touching the originals.

On the bundled `gostown` map it currently shrinks the models **~32%** (≈110 MB → ≈75 MB) by recomputing
normals, welding duplicate vertices, and removing degenerate / duplicate faces — all changes that are provably
**visually identical** (verified by re-parsing every output and checking triangle/material-split consistency).

> Separate sub-project. It reuses the main engine's RenderWare **parsers** read-only (`../src`); all the
> **writing** (the DFF serializer / re-encoder) lives here. The core is game-agnostic — a different game is a
> new adapter.

## Usage

```bash
# from the repo root — --game is a path to the game data, --out where the build is written
npx tsx map-optimizer/src/cli.ts --game ./game-src/gostown --out ./build

# opt-in passes:
npx tsx map-optimizer/src/cli.ts --game ./game-src/gostown --out ./build --textures  # generate mip chains (plan 010)
npx tsx map-optimizer/src/cli.ts --game ./game-src/original --out ./build --refine    # surface smoothing (plan 014)
```

- `--game <path>` — game data (models `*.img` + `data/` IDE/IPL to resolve the map's models).
- `--out <path>` — where the **complete, drop-in build** is written (gitignored; the source is never modified) —
  the whole game-data tree mirrored, with each `models/*.img` **rebuilt**: optimized entries swapped in,
  everything else (vehicles, peds, interiors, data, …) preserved. Point the game at it and it runs. A
  **`report.json`** is written alongside.
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

## Analysis

Read-only measurement tools (no output build), used to decide whether a transform is worth building:

```bash
# curvature scan (plan 014) — how much of a region is flat / gently-curved / crease
npx tsx map-optimizer/src/analyze-curvature.ts --game ./game-src/original --center 2100,1490,15 --radius 200
```

## Pipeline

Edit `src/optimizer.config.ts` (the "gulpfile") to choose/reorder stages. The default pipeline, in order:

1. **weld-vertices** — merge vertices identical in _all_ attributes (position/normal/UV/prelit/night).
2. **remove-degenerate-triangles** — drop zero-area faces (coincident/collinear/equal-index).
3. **dedupe-faces** — remove exact duplicate triangles (keeps two-sided/reversed-winding faces and decals).
4. **prune-vertices** — drop vertices no triangle references.
5. **smooth-normals** — rebuild normals from **smooth groups**, splitting at hard edges (plan 015). SA prelit
   world models ship with broken/absent normals, so the engine smears them (gradients, double-face slivers) →
   SSAO artifacts; this gives flat walls flat normals, sharp edges, correct double faces. Grows vertices at hard
   edges (buildings split a lot, smooth terrain barely) — adds a normals block + splits (~+40% map-wide). The
   topology-preserving `recompute-normals` plugin stays available for callers that can't change vertex count.
6. **condition-prelit** — re-level pathologically dark/bright day-prelit toward a neutral target (RGB only,
   alpha preserved). Only _flat_ near-black / near-white prelit is touched; dark-but-structured models (real
   baked shading) keep their AO. Visual heuristic — calibrate `targetLuma` in-game.
7. **synthesize-night** — give night-less, opaque, bright-enough models a night vertex-colour set derived from
   their day prelit (× `nightScale`, default `0.7`), so they don't go dark at night (the engine darkens
   night-less models). Map-wide visual heuristic — tune `minLuma`/`nightScale` (or restrict it) in-game;
   models that already have night colours are untouched.

Every stage is a small, independently-tested pure transform wrapped in a `MapPlugin`.

## How it works

```
--game <path>  --out <path>
  resolve   reuse the build partition: open models/*.img + parse data/ IDE+IPL → the map's model DFFs
  read      DFF bytes → RWClump (../src parser) → neutral MeshIR
  pipeline  MeshIR ──▶ plugin1 ▶ … ▶ pluginN   (per model, concurrency-limited, errors isolated)
  write     MeshIR → DFF bytes (in-house serializer)   → --out  + report.json
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
