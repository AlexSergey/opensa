# 003 — Phase 2: fill missing LODs (curated)

**Status: ✅ Implemented.** Some HD world pieces ship with **no LOD at all** — when the HD unloads at its draw
distance a hole opens in the far view (seen in both vanilla SA and OpenSA, e.g. `lae2_landhub02`, `lanalley1_lan`).
Phase 1 only upgrades LODs that already exist; this phase **creates** a far-LOD for HD objects that lack one.

**Result** (`game-src/non-modified`, 19 curated models): `filled 19 missing-LOD holes (19 instances, 0 skipped)`.
Verified byte-level on a binary-placed case — `lae2_landhub02` (`lae2_stream2` rec 70) `lod -1 → 377`; its
companion `LAe2.ipl` grew 377→378 with `salodh0003` appended at index 377 at the HD's exact position.

## Why curated, not auto-detected

Measured: 2 530 exterior HD models have no LOD; ~1 281 are ≥ 50 u; ~1 142 are flat-and-wide. But a _hole_ depends
on whether anything covers the ground behind the object — not on its shape. Flat/large catches decals, fences,
wires, night-light overlays that leave **no** hole. Geometry can't tell a hole from a harmless flat object, so
auto-detection over-generates by ~1000×. Instead the user curates the short list of models they actually see
holing (`lod.config.ts` `holeFillModels`); the tool generates a LOD for exactly those. The list grows as more
holes are found.

## Pipeline (per curated model, reuses the `lod-trees-generator` placement pattern)

For each `holeFillModels` entry that is a valid HD-without-LOD (exists, has an IDE def + DFF + source TXD, is not
already a LOD source/target — validated, skip + warn otherwise):

1. **New LOD model** — a fresh object id (`> maxObjectId`, needs **fastman92**; SA's 18 630 ceiling is already
   full), name `salodh<NNNN>`. DFF = the HD's bytes **verbatim** (same as Phase 1 — no format risk). TXD = the HD's
   textures at `texScale` (deduped per source TXD, shared with Phase 1's clone TXDs). COL — none (LODs don't
   collide). IDE `objs` line with a **high draw distance** (`holeLodDraw`, default 1500) so it covers the far view.
2. **Placement + link** — for every HD instance of the model (text IPL rows _and_ binary `_stream` records):
   append a leaf LOD instance (`lod -1`) at the **HD instance's transform** to the area's **companion text IPL**
   (append-only → never shifts the existing index space; see the `ipl-lod-index-coupling` memory), and point the HD
   instance's `lod` at that new index — a text row via `setLod`, a binary record via `linkBinaryLods`.
3. **Emit** — new DFFs/TXDs into `models/gta3.img`; new IDE (`data/maps/salod-holes.ide`) registered in `gta.dat`;
   edited text IPLs + binary streams written into the drop-in `--out` tree.

## Reuse

The area-editing machinery already exists in `lod-trees-generator` (`ipl-text-append` `applyTextEdits`,
`ipl-binary-link` `linkBinaryLods`, `buildLodIde`, the text↔binary coupling walk in `editAreas`). Phase 2 is the
same mechanism with an **HD-clone** LOD per model instead of a per-area tree impostor. Shared helpers move to
`@opensa/map-placement` (its IPL-editing home) or are reimplemented minimally.

## Config / CLI

`lod.config.ts`: `holeFillModels: string[]` (lowercased), `holeLodDraw` (1500). Runs inside the same `--out` build
after Phase 1. Report: filled models, appended instances, skipped (already-had-LOD / missing asset).

## Not in scope

- Auto hole detection (deliberately curated).
- Models that **already** have a LOD but still hole (e.g. `mall_03_sfs`, `traintrax01_sfs`) — that's a broken/
  inadequate existing LOD, a separate fix, not a missing one.
