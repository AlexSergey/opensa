# 002 — Phase 1: clone HD + empty COL + 50 % textures

**Status: ✅ Implemented.** The first mode: **regenerate every per-object LOD as a verbatim clone of its HD
model**, with its textures halved. A drop-in `--out` that replaces the stock LOD DFFs/TXDs in place (same ids,
names and IPL links), so the map's linkage is untouched. See [001-architecture.md](./001-architecture.md) for the
why + measured feasibility.

## Result (`game-src/non-modified`, `--tex-scale 0.5`)

`baked 4275 LOD clones + 996 TXDs @ 0.5× (shared 15, missing HD 0, missing TXD 0)` + `retargeted 5992 LOD
instances to their HD transform` in ~27 s. `models/gta3.img` 897 MB → 1.1 GB (**+~200 MB** — matches the plan-001
LOD-layer estimate). Verified on a sampled pair: the clone LOD DFF is **byte-identical** to the HD DFF, the LOD's
IDE `txd` retargets to the generated clone TXD, and that TXD holds the HD atlas's textures at half res (DXT + mips);
and on the three reported skewed objects: each cloned LOD instance's rotation now equals its HD instance's (e.g.
`LODCOMP1_las2` 0 → −45°). Requires the **fastman92 Limit Adjuster** to load.

## Goal

For each HD model that has a LOD (measured: ~4 300 models / ~6 066 links, `game-src/non-modified`):

1. **Clone** the HD geometry as-is (no decimation) under the **stock LOD name** → no pop, **no holes**.
2. **Empty collision** (LODs don't collide).
3. **Textures at 50 %** (½ each side) — the one deliberate degradation.
4. Emit a **drop-in** build; the game's IPL `lod` links + object ids are **unchanged**.

## Pipeline

### 1. `resolvePairs()` — load the map, read the existing LODs

Resolve every **HD↔LOD** link from the IPL `lod` field — the ground-truth pairing (name matching is unreliable,
see the `lod-detection-name-vs-target` memory):

- **Text IPLs:** `inst.lod ≥ 0` → `instances[inst.lod]` (same file).
- **Binary streams** (`<area>_streamN.ipl` in `gta3.img`): `inst.lod` indexes the **companion text IPL** (pair by
  area key `<area>`), per the `ipl-lod-index-coupling` memory. Resolve `idToModel[inst.id]` (HD) →
  `companionText[inst.lod].model` (LOD).

Reuse/extend `@opensa/map-placement`'s coupling helpers (`ipl-text-strip` / `ipl-binary-strip` already know the
text↔binary index space) — add a read-only `resolveLodLinks`. Output per LOD model: `{ hdModel, lodModel, lodTxd,
lodId }`, deduped (many HD instances share one LOD model). This resolution **is** the "compare with the existing
old LODs" step; emit a sizing report (LOD count, stock vs HD tri totals, est. output size).

**Edge case — shared LODs:** a LOD referenced by instances of **different** HD models (area-shared big-building
LODs) has no single HD to clone. **Phase 1 clones only the 1:1 (per-object) LODs and leaves shared/ambiguous ones
as stock** (report the skipped count). Merging their HDs (a mini-cell) is a later plan.

### 2. `cloneLod(pair)` — clone geometry, halve textures, empty COL

- **DFF — verbatim copy.** The model name is the **IMG entry name**, not stored in the DFF, so the LOD DFF is just
  the **HD DFF bytes packed under `<lodModel>.dff`**. No re-encode. Its material texture-name refs are unchanged,
  so they resolve against the new LOD TXD (same texture names, half-res). _This is the big win:_ a verbatim HD DFF
  already renders in SA, so every strict DFF gotcha (tristrip flag, extra-vert-colour, normals — see
  `sa-generated-asset-format`) is **moot**.
- **TXD — 50 % downscale.** Take the textures the HD model's materials reference (from the HD's txd), downscale to
  `texScale` (½ dim → ¼ area), **DXT + full mip chain** (DXT5 if alpha, else DXT1), pack under the same texture
  **names**. Reuse `@opensa/sa-lod` `encode-txd`. This is the **only generated asset** → the only real risk
  surface (get DXT/mips/format right — the `sa-generated-asset-format` checklist).
- **COL — skipped.** Stock world LODs are collision-less and already work, so replacing the `<lodModel>.dff` by
  name inherits the stock no-COL — nothing to emit. (The empty-112-byte-COL3 path via `@opensa/sa-lod` `encode-col`
  stays available if a future model needs it.)

### 3. `finalize(outDir, cloned)` — repack + retarget, drop-in

- Mirror the `--game` tree to `--out`.
- **Repack `gta3.img`** replacing the stock LOD `<lodModel>.dff` entries + adding the new LOD TXDs (by name), via
  `@opensa/tool-kit` `editArchive`.
- **Retarget the LOD IDE `txd` column** to the new LOD TXD (`@opensa/map-placement` IDE edit).
- **Retarget each cloned LOD _instance's_ transform to its HD instance's** (position + rotation). **This is
  required, not optional:** the stock LOD geometry is baked in a _different local frame_ than the HD, which the
  stock LOD instance's rotation compensated for; dropping in HD geometry under that rotation skews the object (seen
  in-game: `LODxroad46` off by ~24°, `LODCOMP1_las2` by 45°). Since the geometry is now the HD's, the instance must
  match the HD's. The pointed-to LOD instance always lives in a **text** IPL (the `ipl-lod-index-coupling`: binary
  `lod` → companion text), so only text IPLs are rewritten (`@opensa/map-placement/ipl-text-retransform`); the HD
  transform comes from the same text file (text HD) or the area's binary streams (binary HD). Ids, names and every
  `lod` **index** stay byte-identical → no id change, no `lod`-index disturbance.

## Texture packing: per-source-TXD dedup (what shipped)

Stock LODs share one small `lod2*` atlas per area. A clone needs the HD textures at 50 %. The design proposed a
per-**model** TXD first, but that re-encodes a shared HD atlas (e.g. a big `vegas` txd) once **per LOD model** —
thousands of times → multi-GB output and minutes of work. So the implementation dedups by **source HD atlas**: each
distinct HD `txd` is downscaled **once** into a generated `salodNNNN.txd` (DXT + mips), and every LOD whose HD uses
that atlas retargets its IDE `txd` to it. This is between the two proposed options — it needs no name-level dedup
yet lands at the deduped size directly (996 TXDs for 4 275 LODs; +~200 MB). Per-area/name-level dedup stays a later
optimization.

**Known limitation (Phase 1):** the downscale reads pixels through a global `TextureSource` over all archives
("first TXD wins on a name clash"), so a texture name shared across atlases could resolve to the wrong source. The
name + UVs are still correct, so it's at worst a cosmetic far-LOD mismatch on colliding generic names; scope the
source to the HD's own TXD if it ever shows.

## Drop-in guarantee (why this is low-risk)

- **Same ids / names / `lod` indices** → the linkage is never touched (no `≤ 18630` id ceiling, no
  `ipl-lod-index-coupling` crash). The only IPL edit is the cloned LOD **instances'** transform (matched to their
  HD), which moves nothing in the index space.
- **Verbatim HD DFF** → known-good SA geometry; no format-conversion risk.
- Only **new asset = the 50 % TXD**. The blast radius is one encoder.

## CLI + config

```sh
tsx tools/sa-lod-generator/src/cli.ts --game ./game-src/non-modified --out ./build [--tex-scale 0.5]
```

`lod.config.ts`: `texScale` (0.5). Without `--out`, print the resolve/sizing report only (Phase-0 style).

## Exclusions (kept stock, reported)

Beyond shared multi-HD LODs, `resolveLodLinks` skips cloning a LOD when it is **dual-role** (also placed standalone
— cloning its DFF corrupts that placement) or its HD/LOD is **vegetation** (`SA_TREE_MODELS` — trees get
`lod-trees-generator` impostors, not HD clones).

## Testing

- **Unit:** TXD downscale (½ dim, DXT + mips, alpha→DXT5), empty COL3 = 112 bytes, `resolveLodLinks` (text
  internal + binary→companion) on synthetic IPLs, per-model clone identity (LOD DFF bytes == HD DFF bytes).
- **Real-asset integration** (`npm run test:fixtures`, extend the MANIFEST — build tooling, not the engine): a
  known stock HD↔LOD pair — assert the clone LOD = HD geometry, the LOD TXD is half-res DXT of the HD textures, and
  the IDE line retargets the txd.

## Prerequisite

**fastman92 Limit Adjuster** for the raised stream/model/TXD memory (~200–250 MB LOD layer, plan 001). No id-limit
change needed (ids reused). Document in the readme.

## Deferred (future plans)

- **Per-area shared TXD** (dedup textures → hit ~100 MB).
- **Drop small/cheap objects** (`--min-size`): keep their stock LOD or none — trims the ×5 far-view budget.
- **Problem-objects-only mode:** regenerate only LODs whose HD/stock-LOD detail gap is visually ugly.
- **Light-decimation middle ground** (e.g. 60 %) as an alternative to full clone if far-view perf needs it.
- **Shared-LOD (multi-HD) handling** — merge the covered HDs into one clone (a mini-cell).
