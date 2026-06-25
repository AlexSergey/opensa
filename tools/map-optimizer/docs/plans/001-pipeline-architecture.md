# 001 — Map optimizer: pipeline architecture (base)

**Status: ✅ Base implemented.** A standalone, offline CLI that conditions a game's **map models** through a
composable, Gulp-style plugin pipeline — fix normals, weld/dedupe geometry, fill holes, refine meshes, etc.
This plan defines **only the base architecture** (no transform plugins): the CLI + game-param input, source
resolution, the pipeline runner + plugin contract, the intermediate mesh representation (IR), the DFF
read↔write codecs (incl. an identity round-trip), output, and reporting. Each actual transform is a follow-up
plan (002+).

> **Implemented.** `core/*` (game-agnostic: `ir`, `asset`, `adapter`, `pipeline`, `report`) + `adapters/gta-sa/*`
> (RenderWare adapter: `resolve`/`read` reuse `../src` read-only; `codec/*` is the in-house **DFF serializer** —
> a faithful chunk-container codec (`chunk.ts`, byte-exact `writeRw(readRw())`), an in-place vertex-attribute
> patcher (`geometry-struct.ts`), and the `encodeDff` orchestrator) + the `pass-through` plugin +
> `optimizer.config.ts` + `src/cli.ts`. Verified: `tsc`/`eslint` clean; core + serializer unit tests; and
> `--game gostown` round-trips **836/836** map models **byte-identical**. The serializer patches
> positions/normals/prelit/UVs only — topology edits and anti-rip recovered geometry throw (full re-encoder =
> later). Build wiring: eslint `scripts`-config + `vitest` include + `.gitignore` cover `map-optimizer/**`.

Reuses the main project's renderware parsers + build partition (the engine in `../src`); separate project,
one-directional dependency. Related: the runtime in-memory alternative in
[../../../docs/ideas/map-optimizer.md](../../../docs/ideas/map-optimizer.md) (this plan instead chooses the
**offline, writes-optimized-assets** path, mirroring `scripts/build-game.ts`).

## Context / problem

Mod re-exports and even stock map DFFs carry geometry defects: unreliable normals (flat/per-face/garbage),
welded-apart vertices, duplicate/coplanar polygons (z-fighting), holes, inconsistent prelit/night colours.
Today the engine only **parses** DFFs (read-only) and patches the worst at load time
(`sanitizeDegenerateNormals`). We want a **batch tool** that takes a `--game` (like `build-game.ts`), finds the
models the map actually uses, runs them through composable transforms, and **writes back optimized DFFs** — so
the cleanup is durable, inspectable, and reusable outside the runtime.

The hard part is not the transforms; it is (a) a **DFF writer** (we have none) and (b) a neutral mesh model the
plugins can mutate without touching raw RenderWare chunk layout. This plan builds that scaffolding and proves
it with a **no-op pass-through plugin** + an **identity round-trip** (read → IR → write → read is equivalent),
which is the correctness gate before any geometry-mutating plugin lands.

## Decisions (proposed)

- **Offline CLI, not runtime.** `map-optimizer --game <name>` reads `game-src/<name>/` and writes optimized
  output to `map-optimizer/out/<name>/`. **Source is never overwritten.** (The runtime in-memory option from
  the idea note stays a separate possibility; this project targets durable, portable assets.)
- **Per unique model, not per placement.** Map objects are model definitions placed many times via IPL;
  optimize each **DFF once**, keyed by model name.
- **Gulp-style pipeline.** An ordered list of plugins; each receives an **asset** (a "vinyl"-like object),
  mutates its **IR**, and passes it on. Plugins are pure-ish, independently testable, order-significant.
- **Neutral IR.** Plugins operate on an intermediate mesh model (positions / normals / uvs / day+night prelit
  / per-material triangles / materials / bounds), **decoupled from RW chunks**. Codecs convert `RWClump ⇄ IR`;
  chunks the IR doesn't model are kept as **raw passthrough** on the asset so the writer can re-emit them.
- **Writer = passthrough-first.** The DFF serializer re-emits parsed geometry + materials and **passes through
  every unparsed chunk raw** (2dfx, skin, breakable, env-map, uv-anim, hanim, right-to-render). It only
  regenerates `BinMeshPLG` + section sizes when topology actually changes. The base plan ships the writer at
  **identity** fidelity (no transforms) and gates it with a round-trip test.
- **Reuse, don't fork.** Import the renderware parsers (`parseDff`/`parseTxd`/`ImgArchive`) and the build
  partition (`placedModels`/`ideRefs`/`partitionEntries`) from `../src`. The optimizer **must not** import the
  game/engine/three layers; the dependency is one-directional.

## Architecture

```
map-optimizer --game <name>
  │
  ├─ resolve      reuse build partition: open models/*.img + parse data/ IDE+IPL
  │               → the unique EXTERIOR map model DFFs the game references
  │
  ├─ read         per model: bytes → parseDff (RWClump) → toIR(clump)
  │                 asset = { name, ir, raw: <unmodeled chunks>, meta, log }
  │
  ├─ pipeline     asset ──▶ plugin₁ ──▶ plugin₂ ──▶ … (ordered, concurrency-limited,
  │               (no-op "pass-through" only, in this plan)   per-asset error isolation)
  │
  ├─ write        fromIR(ir) + raw passthrough → writeDff → bytes
  │
  └─ output       write loose .dff to map-optimizer/out/<name>/  +  run report
```

### Core contracts

```ts
/** The unit flowing through the pipeline (Gulp "vinyl"-like). */
interface Asset {
  name: string; // model id (e.g. "des_logcabin")
  ir: MeshIR; // the editable geometry (what plugins mutate)
  raw: RawClumpRest; // chunks the IR doesn't model — re-emitted verbatim
  meta: Record<string, unknown>; // scratch space for plugins
  log: AssetLogEntry[]; // applied transforms + diagnostics (before/after stats)
}

/** A pipeline stage. Mutates the asset's IR (or skips). Order matters. */
interface MapPlugin {
  name: string;
  accepts?(asset: Asset): boolean; // default: all
  transform(asset: Asset, ctx: PipelineCtx): Promise<void> | void;
}

/** Pipeline definition (the "gulpfile"): ordered plugins + I/O + options. */
interface OptimizerConfig {
  plugins: MapPlugin[];
  concurrency?: number; // default ~4 (mirror build-game)
  out?: string; // default map-optimizer/out/<game>
}
```

`MeshIR` (first cut): `{ positions, normals, uvLayers, prelit, nightColors, materials, faces[] grouped by
material, boundingSphere }` — enough for normals/weld/dedupe/prelit plugins later; adjacency is built lazily
by plugins that need topology (hole-fill/remesh).

## Project layout (proposed)

```
map-optimizer/
  docs/plans/001-pipeline-architecture.md   ← this
  optimizer.config.ts        # the default pipeline (a single no-op plugin for now)
  src/
    index.ts                 # CLI entry: --game, validate, run
    resolve.ts               # which model DFFs the map uses (wraps ../src/game-build/partition)
    pipeline.ts              # the runner (ordered plugins, concurrency, error isolation)
    asset.ts                 # Asset + MapPlugin + OptimizerConfig types
    codec/
      ir.ts                  # MeshIR type
      dff-to-ir.ts           # RWClump → IR  (+ captures raw passthrough)
      ir-to-dff.ts           # IR + raw → RWClump
      dff-writer.ts          # RWClump → bytes  (the new serializer)
    plugins/
      pass-through.ts        # no-op (proves read→pipeline→write end to end)
    report.ts                # per-asset + run summary (console + optional JSON)
  out/                       # generated, gitignored
```

Tooling: reuse the repo's `tsx` + root tsconfig at first (run `tsx map-optimizer/src/index.ts --game <name>`);
extracting a standalone package is a later option, not now.

## Scope

- **In:** the CLI + `--game` input + folder validation; source resolution (unique exterior map models, via the
  build partition); the **pipeline runner** (ordered plugins, concurrency, per-asset error isolation); the
  **Asset / MapPlugin / config** contracts; the **`MeshIR`** + `dff↔ir` codecs; the **DFF writer** at
  **identity** fidelity with **raw passthrough** of unmodeled chunks; loose-DFF output to `out/<game>/`; the
  **reporting** skeleton; a **no-op `pass-through` plugin** exercising the whole loop; tests.
- **Out (follow-up plans 002+):** every transform plugin (normals/smoothing, weld, dedupe, hole-fill, remesh,
  prelit/night conditioning, wind authoring); TXD/texture work; repacking output into `.img`; performance
  tuning; any GUI; standalone npm-package extraction.

## Risks / testing

- **DFF writer fidelity is the central risk.** Mitigation: passthrough-first design + an **identity
  round-trip** gate — `read → write → read` must be byte-equivalent for chunks we re-emit, and the produced
  DFF must load unchanged in the existing engine/viewers. Validate against the "dirty" fixtures called out in
  the idea note (`casroyale` zero-normals, `trafficlight`) plus a full stock-map sweep.
- **IR ⇄ RW lossiness.** Define precisely what the IR models vs what stays raw; anything not modeled must be
  preserved verbatim (test: a model with skin/2dfx/breakable round-trips intact).
- **Topology cascades** (for later plugins, but the IR must allow it): material indices, `BinMeshPLG`, day+night
  prelit arrays, UVs, bounding sphere all move together when faces change — the writer regenerates them; the IR
  keeps day+night prelit + per-material grouping so future plugins stay correct.
- **Boundary discipline.** The optimizer imports only `../src/renderware` + `../src/game-build`; a lint/knip
  check (or a simple import guard) keeps the engine/three layers out.
- **Tests:** pipeline runner (ordering / concurrency / one bad asset is isolated) with fake plugins; codec
  round-trip against real DFF fixtures; source resolution against a fixture game. Deterministic, real-asset
  (no mocks), negative-cases-first per the repo convention.
