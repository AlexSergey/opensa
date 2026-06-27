# 004 — map place (stage 2: attach impostor LODs to the tree HDs)

Stage 1 ([003](./003-map-strip.md)) proved we can edit the coupled text/binary IPLs without crashing. Stage 2
uses the same index discipline to **give every streamed tree HD a far-LOD = our impostor**, mirroring SA's own
HD↔LOD pattern (streamed HD in a binary stream → bigbuilding LOD in the companion text IPL).

## What the map looks like (measured, clean US 1.0)

- The 286 `--dff` source models are **all** stock model names (same-name); `lod<name>` impostors are new assets.
- **10211** instances of source models live in the **binary streams**; **9860 have `lod = -1`** (no LOD today),
  351 already point at a stock LOD.
- Naming isn't a clean `X` / `lod<X>` split — e.g. there is no `vbg_fir_co`, only `lod_vbg_fir_co`, placed in
  both streams and text. So Stage 2 keys off **instances of a source model**, not a name convention.

## Placement rule — attach-in-place, 1 LOD per streamed HD

Decisions: **keep HD where SA streams it**; **strip procobj** tree scatter. We do **not** move or delete HD
instances. For each binary-stream instance of a source model, ensure it has a text-IPL LOD = its impostor:

| HD state          | action                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lod = -1` (9860) | **append** a `lod<name>` instance to the area's companion text IPL at the HD's pos/rot (interior copied, `lod -1`); set the binary HD's `lod` to the appended index |
| `lod ≥ 0` (351)   | **repoint in place**: overwrite the existing stock-LOD text instance's id → the impostor id (same index, no append, HD `lod` unchanged)                             |

Text-IPL source instances (always-loaded bigbuildings) are handled the same way **within their own file**: append
the impostor as a leaf row and set the HD row's `lod` column to it (or repoint an existing LOD row) — a
text-internal link, no binary coupling. Areas are iterated as _every text IPL ∪ every binary-stream area_, so a
model placed only in text is no longer skipped (it was the "in `--dff`, not procobj, yet no LOD and not swapped"
bug). These HDs also enter `placedSources`, so their DFF is swapped like any other.

### Why appends are safe

Appends go at the **end** of the text `inst` section, so every existing text/binary `lod` index is unchanged;
the only edits are (a) the new rows, (b) the targeted binary `lod` fields / text `lod` columns, (c) the repointed
ids. No re-index needed — the inverse of the Stage-1 removal, and just as index-consistent.

## Asset registration

- Allocate 286 object ids from the **lowest free ids inside the stock id space** (scan all IDE ids; assign the
  lowest unused ids ascending — **not** necessarily contiguous, since a heavily-modded game rarely leaves a
  286-wide consecutive gap below the ceiling). Ids **must stay ≤ 18630** (the stock max) — ids above it silently
  fail to load on stock SA without a limit adjuster, which is exactly the "HD swapped but no LOD" symptom (so the
  allocator throws if it can't fit every model ≤ 18630 rather than spilling past it).
- Emit a dedicated **`lodtrees.ide`** (`objs`: `id, <model>, lodtrees, 600, 2130048` — stock tree-LOD draw
  distance + flags) and splice an `IDE` line into `gta.dat` after the stock IDEs.
- **Model name** is `lod<source>`, except names that would overflow the IMG entry limit (≤ 23 bytes incl `.dff`,
  17 of 286) get a short `lodt<index>` alias — the DFF still references its `lod<source>` texture in
  `lodtrees.txd`, so visuals are unaffected.
- Ship the impostor DFFs + the shared `lodtrees.txd` in the repacked `gta3.img` (or loose `gta3img/` with
  `--loose`). Impostors get **no collision** (LODs never need it — the HD carries collision up close).

## HD DFF + TXD swap

Decision: **swap the HD DFF for every LOD'd model**, except procobj species are kept stock (so their runtime
scatter is unchanged) **unless `--procobj`** is passed (which converts that scatter to static — see
[Stage 3](#stage-3--procobj--static-ipl) and [`007 §C`](./007-impostor-improvements.md)). Without `--procobj` this
is 144 of the placed source models on the stock set.

The swapped DFFs reference textures in the user's `--txd`, not the stock TXD their IDE names, so `retxd.ts` also:
pack the custom TXD(s) into `gta3.img`, and rewrite each swapped model's IDE `txd` column to the custom TXD that
covers its textures. A model is repointed **only** when a custom TXD actually contains its textures (≥1 hit) — a
swapped model whose textures aren't in any custom TXD (e.g. a procobj desert plant still using stock
`gta_procdesert` textures, pulled in via `--procobj`) **keeps its stock `txd`**, since repointing it to a TXD that
lacks its textures would strip them (renders untextured). Without the repoint for genuinely custom-textured HDs
they render white.

## Output (under `--out`)

- repacked `gta3.img`: edited binary streams (HD `lod` set) + impostor DFFs + `lodtrees.txd` + swapped HD DFFs,
- edited text IPLs under `data/maps/...` (appended LOD rows / repointed ids),
- `data/maps/lodtrees.ide` + patched `data/gta.dat`. `procobj.dat` untouched (unless `--procobj`).

## Caveats / to confirm in-game

- ~9860 appended instances world-wide may approach SA's `CPool` / IPL instance limits → may need a limit
  adjuster, or a distance gate (only LOD trees past N metres). **First thing to watch in-game.**
- The impostor is baked from the `--dff` mesh; if `--dff` differs from the stock HD of a _non-swapped_ (procobj)
  model, the LOD↔HD transition can mismatch slightly.

## Stage 3 — procobj → static IPL

Converting `--dff ∩ procobj` species from runtime scatter to static IPL + impostor LODs (`area / spacing` is
~2 M at full density, so it is thinned by MINDIST min-spacing + a cap). Implemented in
[`006-procobj-place.md`](./006-procobj-place.md).

## Module shape

`adapters/gta-sa/place/` mirroring `strip/`: `place-map.ts` (orchestration) · `ipl-text-append.ts` (append /
repoint rows) · `ipl-binary-link.ts` (set HD `lod` fields) · `ide.ts` (free-gap id allocation + alias +
`lodtrees.ide` + `gta.dat` patch) · `retxd.ts` (custom-TXD pack + IDE `txd` rewrite for swapped HDs). Reuses the
area-pairing + `gta3.img` repack discipline from `strip/`.
