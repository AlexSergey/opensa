# sa-lod-generator

Regenerates **GTA-SA's per-object LODs as HD-quality clones** for the **real game** (contrast with
`opensa-lod-generator`, which bakes decimated _cell_ LODs for OpenSA). Every LOD becomes a verbatim copy of its HD
model with a half-res texture, so far-view geometry matches the HD exactly — no pop, no holes. A drop-in `--out`
build: it edits `models/gta3.img` + the map data in place, never touching the id space of existing LODs.

See [`docs/plans/`](./docs/plans) for the design: [001](./docs/plans/001-architecture.md) (architecture +
measured feasibility), [002](./docs/plans/002-clone-lods.md) (Phase 1 clone), [003](./docs/plans/003-fill-missing-lods.md)
(Phase 2 hole-fill).

## Usage

```sh
# Report only (no build) — LOD counts + stock-vs-clone triangle budget:
tsx tools/sa-lod-generator/src/cli.ts --game ./game-src/non-modified

# Drop-in build:
NODE_OPTIONS=--max-old-space-size=8192 \
tsx tools/sa-lod-generator/src/cli.ts --game ./game-src/non-modified --out ./build/salod [--tex-scale 0.5]
```

`--game` is a game-data dir (`data/` + `models/` with `gta3.img`). Without `--out` it prints the sizing report.
Needs ~8 GB heap (`NODE_OPTIONS`) for the texture indexing.

## What it does

The LODs it touches are found from the IPL `lod` **index** (ground truth), not the `lod`-name prefix (unreliable —
see the `lod-detection-name-vs-target` memory). The text↔binary `lod`-index coupling is handled per area.

**Phase 1 — clone existing LODs** (plan 002):

- Replace each **per-object** LOD's `.dff` with its HD's bytes **verbatim** (a known-good SA clone — sidesteps every
  DFF format gotcha), add one ½-res DXT TXD per source atlas (deduped), retarget the LOD's IDE `txd`.
- Retarget each cloned LOD **instance's** transform to its HD instance's — the stock LOD geometry was baked in a
  different local frame, so an HD clone under the stock rotation would skew (see `lod-clone-needs-hd-instance-transform`).
- **Skipped** (kept stock): shared multi-HD LODs, dual-role LODs (also placed standalone — cloning corrupts them),
  and vegetation (`SA_TREE_MODELS` — trees get impostors from `lod-trees-generator`).

**Phase 2 — fill missing LODs** (plan 003): for the curated `holeFillModels` (HD pieces with **no** LOD that hole
the far view), generate a new far-LOD — new id + IDE def (`data/maps/salod-holes.ide`) + a leaf LOD instance
appended at the HD's transform with the HD's `lod` pointed at it (text row or binary stream record).

## Config (`src/lod.config.ts`)

| key              | meaning                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `texScale`       | LOD texture downscale (`0.5` = ½ each side).                                                                                                                                                                                                                                      |
| `holeFillModels` | **Curated** HD models with no LOD to give a generated far-LOD. Auto-detection over-generates ~1000× (a hole depends on ground coverage, not shape), so this is opt-in — extend it as holes are spotted in the viewer. Entries that already have a LOD are skipped with a warning. |
| `holeLodDraw`    | Draw distance for the generated hole-fill LODs (default 1500).                                                                                                                                                                                                                    |

## Prerequisites

- **fastman92 Limit Adjuster** — Phase 1 raises the LOD-layer stream/TXD memory (~+200 MB); Phase 2 needs raised
  **model-id** limits too (new ids are `> 18630`, SA's ceiling is already full).
- The OpenSA map viewer classifies HD/LOD by the IPL `lod` index (`IplInstance.isLod`), so name-mismatched clones
  (`nw_lodbit_18`, …) show correctly under "Show LODs".
