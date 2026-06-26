# 005 — SA asset-format requirements (Stage-2 bring-up findings)

Getting the generated impostors to actually render in **GTA San Andreas** took a long chain of fixes. The
common theme: **SA's RenderWare is strict where our own parser/viewer is lenient**, so a DFF/TXD/COL that loads
fine in the viewer can be invisible — or crash — in the game. This is the checklist (each was a real bug, each
is now enforced by the encoder + covered by tests).

## DFF (the impostor mesh)

- **Tristrip flag must match the data.** The template clump we rebuild over is a _tristrip_ geometry, but the
  card mesh is written as a triangle **list** (BinMesh prim `0`). Leaving `rpGEOMETRYTRISTRIP` (flags bit `0x01`)
  set makes SA read the list as a strip → **draws nothing**. → `clearTristripFlag` (`dff-edit.ts`).
- **Strip the template's extra-vertex-colour extension.** `encodeDff` rebuilds the geometry but carries the
  template's `0x253f2f9` (`rpEXTRAVERTCOLOUR`, one RGBA per vertex) extension **verbatim** — sized for the
  template's vertex count (e.g. 432 bytes for a 107-vert road LOD), not our 16-vert card. SA then applies stale
  colours/alpha to our vertices → the mesh renders **black / fully transparent**. → `stripExtraVertColour`.
- Material colour / prelit don't need to match a reference (ours is brighter white and renders fine), and the
  bounding sphere computed by `encodeDff` is correct — those were ruled out, not fixed.

## TXD (the shared atlas)

- **Must be compressed.** 286 textures × 256² **A8R8G8B8** = a **~95 MB** single TXD, which SA silently fails to
  load (→ untextured → invisible). **DXT5** at 128² brings it to ~6 MB — matching the reference LOD-veg mod
  (which also splits its LOD textures per region). → `encode-txd.ts` emits DXT5 (header: rasterFormat `0x8300`,
  d3dFormat `"DXT5"`, depth 16, flags `0x09`), default `--tex 128`.

## COL (the impostor collision)

- **An empty COL3 model is exactly 112 bytes** (name 22 + modelId 2 + bounds 40 + a **48-byte zeroed** tail of
  counts/offsets/shadow). We emitted **108**; SA reads the short model, **misaligns parsing the rest of the
  library, and corrupts collision globally** — faulting an _unrelated_ model with "model … does not have loaded
  collision" (the `3999` crash). → `encode-col.ts` writes 112-byte bounds-only models.
- **Collision binds by name, not id** (`modelId` stays `0`, like stock), and the col model name must equal the
  IDE/IMG model name (the alias). SA **auto-discovers `.col` entries inside `gta3.img`** (stock has 0 `COLFILE`
  lines), so the library just needs to be packed — but it _must_ be packed, or every impostor faults on
  collision.

## IDE / IMG

- **Model ids must stay ≤ 18630** (the stock max). Ids above it silently **fail to load** on stock SA without a
  limit adjuster ("no LODs, no crash"). Allocate from a free gap _inside_ the stock id space (`ide.ts`
  `findFreeBlock`), not above it.
- **LOD `objs` flags `2097284`** (the Proper-Fixes value) + the `--draw` distance.
- **IMG entry names ≤ 23 bytes** (incl `.dff`) → model names ≤ 19; longer impostor names get a short `lodt<i>`
  alias (the DFF still references its `lod<source>` texture in the TXD).
- **Swapped HD models need their custom TXD packed + their IDE `txd` column retargeted** to it, or they render
  white (`retxd.ts`).

## How we found them

Static analysis got the assets byte-equivalent to a working reference (Proper Fixes "LOD Vegetation"), but the
decisive tool was an **in-game isolation test**: place one impostor as a plain object next to a stock control at
a known spot (Grove St), then bisect — stock renders / ours doesn't ⇒ the DFF; swap our geometry onto a stock
model with stock TXD/COL ⇒ isolates geometry from TXD. Each layer peeled off one bug above.

## Still open

The **building-pool limit**: +~9860 LOD instances world-wide may exceed SA's `CPool<CBuilding>` (the reference
mod side-steps this with a runtime ASI rather than static IPL). If dense areas misbehave, the fix is a limit
adjuster or a distance gate — see [`004-map-place.md`](./004-map-place.md).
