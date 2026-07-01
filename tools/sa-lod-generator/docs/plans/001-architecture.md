# 001 — sa-lod-generator architecture

**Status: 📝 Proposed (design).** A standalone tool that **regenerates GTA-SA's per-object LODs as HD-quality
clones** — for each HD model that has a LOD, emit a new LOD whose geometry is the **HD copied as-is (no
decimation)**, with **empty collision** and its **textures halved (50 %)**. Targets the **real game** (unlike the
sibling `opensa-lod-generator`, which bakes chunked cell-LODs for OpenSA only). Mirrors the proven tool shape:
game-agnostic core + per-game adapter, reusing the engine's parsers read-only and the shared `@opensa/sa-lod`
pipeline.

## Why a separate tool (and how it differs from opensa-lod-generator)

Two opposite LOD schemes, two targets — kept apart so neither muddies the other:

|           | `opensa-lod-generator`                                               | **`sa-lod-generator`** (this)                                              |
| --------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| scheme    | **cell** LODs: merge a whole 256 m cell → one decimated mesh + atlas | **per-object** LODs: clone each HD model 1:1                               |
| geometry  | QEM-decimated (lossy) — fights holes / flat-island erosion           | **HD as-is (no decimation) → no holes**                                    |
| target    | **OpenSA only** — crashes real SA (271 materials/cell, size caps)    | **real SA** — per-model = normal vert/material counts, no cell-merge crash |
| textures  | one per-cell atlas                                                   | HD textures **downscaled 50 %**                                            |
| ids / IPL | new ids, new IPL placements                                          | **reuses the stock LOD ids/names + IPL `lod` links → true drop-in**        |

The name matches the shared library `@opensa/sa-lod` it leans on (encode DFF/TXD/COL); the tool is
`@opensa/sa-lod-generator` in `tools/sa-lod-generator/`.

## The scheme (per-object HD clone)

SA links each LOD'd HD instance to a LOD instance via the IPL `lod` index; the LOD model is a hand-made low-poly
stand-in sharing one tiny per-area atlas (measured: stock LODs are **~23 % of HD triangles**, textured from a
shared `lod2*` atlas). We **replace each stock LOD DFF in place** (same model name/id) with a clone of its HD, so:

- **no decimation** → the LOD is pixel-identical to the HD (no pop, no holes — the whole point);
- **same name/id + IPL linkage untouched** → a true drop-in (no id allocation, no IPL rewrite, so the
  text↔binary `lod`-index space is never disturbed — see the `ipl-lod-index-coupling` memory);
- **empty collision** (LODs never collide);
- **50 % textures** — the one deliberate degradation, the memory lever that keeps texture cost sane.

## Measured feasibility (this repo, `game-src/non-modified`)

Only **~6 066 HD instances have a LOD** (most props/small buildings have none — they just vanish at distance), so
the clone scope is bounded: **~4 300 LOD models**. Full-clone vs stock, map-wide:

- **far-view geometry: ×5.0** (595 k → 2.99 M tris) · **LOD-layer / stream geometry: ×4.6** (470 k → 2.15 M tris).
- **textures @50 %: ~×7** over the stock shared atlases (~15 MB → ~100 MB map-wide; @100 % would be ~440 MB).
- **absolute LOD layer ≈ 200–250 MB** (geometry ~100–150 MB DFF + ~100 MB textures).

Verdict: **feasible on real SA with a limit adjuster (fastman92)** for the stream/model budget — modern hardware
renders 3 M tris trivially; the barrier is memory, not FPS. Per-object clones carry **normal per-model vert/
material counts**, so they avoid the per-cell material/size caps that crash stock SA on `opensa-lod-generator`'s
output. See the `opensa-lod-generator-decimation` memory for that real-SA crash history.

## Shape (mirrors map-optimizer / opensa-lod-generator)

```
cli.ts  --game <path>  →  game data dir  →  --out <path>  (drop-in build)
  core/       game-agnostic: the pair (HD↔LOD) type, the LodCloneAdapter contract, run summary/report
  adapters/   per-game I/O behind the contract; gta-sa reuses the engine parsers READ-ONLY
  lod.config  texScale (0.5) + (later) size gate / per-object knobs
```

**`LodCloneAdapter`** (the whole per-game surface):

- `resolvePairs()` — load the map, resolve every **HD↔LOD** link from the IPL `lod` field (text-internal +
  binary-stream→companion-text coupling), returning `{ hdModel, lodModel, lodTxd, lodId }[]`. "Compare with the
  existing old LODs" = this resolution.
- `cloneLod(pair)` — read the HD DFF; clone its geometry verbatim; downscale the HD textures the model uses to
  `texScale`; build an empty COL. Returns the new `{ dff, txd, col }` under the **stock LOD name**.
- `finalize(outDir, cloned)` — mirror the game tree to `out/`, repack the new LOD DFF/TXD/COL into `gta3.img`
  **replacing the stock LOD entries by name**, retarget each LOD's IDE `txd` column to its new TXD. Drop-in.

## Reuse (leaf packages — never modify the engine `../src`)

- **`@opensa/sa-lod`** — `encode-txd` (downscale + DXT + mips), `encode-col` (empty COL3), `texture-source` /
  `model-source` (read HD DFF/TXD from the archives). Geometry is **copied**, not decimated (rw-codec chunk copy).
- **`@opensa/map-placement`** — IDE `txd` retarget + the IPL `lod`-link resolution (extend its `ipl-text-strip` /
  `ipl-binary-strip` coupling helpers, or add a read-only `resolveLodLinks`). Also `hasHdTwin` (already shared).
- **`@opensa/tool-kit`** — editable VER2 IMG (`editArchive`) to repack `gta3.img`.
- **`@opensa/rw-codec`** — byte-level chunk read/write for the verbatim DFF clone.

## Principles

- **Never modify the engine `../src` / `packages/**`\*\* — read-only reuse of parsers; every writer lives here or in
  the shared leaf packages (same discipline as map-optimizer / opensa-lod-generator).
- **Drop-in over the stock LODs** — reuse their ids/names + IPL linkage; **no new ids, no IPL rewrite** (avoids the
  `≤ 18630` id ceiling and the `lod`-index-coupling crash).
- **Real-game output** — standard RenderWare DFF/TXD/COL + edited text IDE; loads in stock SA (with a limit
  adjuster for the memory). No OpenSA-specific data.
- **Game-agnostic core + per-game adapter** — a new game is a new adapter.

## Prerequisite

**fastman92 Limit Adjuster** (or equivalent) for the raised stream/model/TXD memory (~200–250 MB LOD layer). Model
ids are **unchanged** (we reuse stock LOD ids), so no id-limit adjustment is needed.

## Roadmap

- **Phase 1 — clone HD + 50 % textures** (plan 002, ✅ implemented): the drop-in above, regenerating **every**
  per-object LOD'd object from its HD (COL skipped — stock LODs are collision-less). Shared/multi-HD, dual-role, and
  vegetation LODs left stock.
- **Phase 2 — fill missing LODs** (plan 003, ✅ implemented): generate a new far-LOD (new id + IDE + appended LOD
  instance + `lod`-link) for a curated list of HD pieces that have no LOD and hole the far view.
- **Future (later plans):** drop small/cheap objects from the clone set (keep their stock LOD or none); per-object
  texture scale; a "problem-objects only" mode (regenerate only where the HD/LOD detail gap is ugly); optional
  light decimation as a middle ground; SA back-face-culling considerations (see the `sa-world-no-backface-cull`
  memory — cloned HD geometry already renders like the HD, so no special handling expected).
