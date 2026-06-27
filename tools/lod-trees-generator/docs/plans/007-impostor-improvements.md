# 007 — impostor improvements (aspect-aware atlas + stock prelight transfer)

Two quality fixes for the placed assets. Independent, can land separately. **Plan only — no code yet.**

---

## A. Aspect-aware impostor textures — **implemented**

### Problem

Every impostor texture is **square** (`textureSize²`), and each card's silhouette is stretched **independently**
on each axis to fill a square tile. In `render.ts` `toPx` maps the card's horizontal span `uSpan` → `[0, tile)`
and its vertical span `zSpan` → `[0, tile)` separately, so for a tall narrow tree (`zSpan ≫ uSpan`) the texels
become anisotropic: vertical resolution is under-sampled by ~`zSpan / uSpan`.

The in-world quad restores the geometric proportions (it uses `worldU` / `worldZ`), so this is **not** geometric
distortion — it is **resolution distortion**: the trunk and vertical canopy structure lose vertical detail and the
alpha-cutout silhouette gets vertically jaggy. A 128² tile on a 2 m × 10 m fir spends as many rows on 10 m as a
square tree spends on 2 m.

### Fix — let the texture aspect follow the tree

If `bboxHeight / bboxWidth` exceeds a threshold (~**2**), bake the impostor into a **portrait** texture
(e.g. `128 × 256`) instead of square, so each texel is ~square in world space and vertical detail is preserved.

What makes this cheap (already true today):

- Each impostor is its **own named texture** in the shared TXD (not one packed mega-atlas), so each can carry its
  own dimensions independently — no shared-grid constraint across trees.
- `buildMipChain(image, width, height)` (rw-codec/mip) already handles non-square.
- The TextureNative header writes `levels[0].width` / `.height` independently (`encode-txd.ts`), so a non-square
  raster already serialises correctly. DXT5 only needs each dim to be a multiple of 4 — the power-of-two presets
  below satisfy it.

### Design

- Per impostor, derive orientation from the bbox: `width = max(spanX, spanY)`, `height = spanZ`,
  `ratio = height / width`.
  - `ratio ≤ THRESHOLD` (~2) → **square** `S × S` (today's behaviour, no change).
  - `ratio > THRESHOLD` → **portrait** `S × 2S` (tiles 1:2).
- **Discrete presets** (1:1, 1:2) — keeps both dims power-of-two (DXT/mip-safe) and the change minimal. Continuous
  aspect would force arbitrary dims (DXT padding, odd mip tails) → rejected.
- Atlas layout keeps the `cols = ceil(sqrt(count))` grid but with `tileW × tileH` cells:
  `atlas = (cols·tileW) × (rows·tileH)`. 4 cards portrait → 64×128 tiles → 128×256 atlas. Each card raster is
  `tileW × tileH` (`createRaster` already takes `w, h`).
- A landscape preset (`2S × S`) for wide low bushes (`ratio < 1/THRESHOLD`) is a trivial extension but **out of
  scope** — the source set is trees, so portrait is the only case that matters now.

### Code touch (for the implementation)

- `core/types.ts` — `Impostor.size: number` → `width` / `height` (keep one as the square default).
- `core/render.ts` — a `pickAtlasShape(bbox, textureSize, threshold)` → `{ width, height, cols, rows, tileW,
tileH }`; tile raster + blit use `tileW/tileH`; atlas allocated `width*height*4`.
- `core/cards.ts` — UV normalisation divides `x` by `width`, `y` by `height` (currently both by `size`).
- `adapters/gta-sa/encode-txd.ts` — `buildMipChain(image, width, height)`; header already reads from `levels[0]`.
- `config.ts` — `aspectThreshold` (default 2); expose `--aspect` only if tuning proves necessary (start internal).

### Caveat

A portrait texture is 2× the bytes of a square one (128×256 vs 128²). Across hundreds of impostors this grows
`lodtrees.txd`; DXT5 keeps it modest, but it's the thing to watch on the IMG-size budget.

---

## B. Stock prelight transfer (`--prelight`) — **implemented**

### Problem

The swapped custom HD DFFs (the user's `--dff`, packed **verbatim** into `gta3.img` by `swapEntries`) often ship
with **badly configured prelight** — vertex colours that are too dark/bright/black versus the stock model the game
lit for that spot. SA renders foliage as `prelit × material`, so wrong prelit = wrong in-world look (a custom tree
that's black or washed-out next to stock geometry).

### Fix — copy the stock model's prelight into the custom DFF

With `--prelight`, before packing each swapped custom DFF, read the **stock** model's DFF (the same
`<model>.dff` already present in the opened `gta3.img` archive), extract its prelit, and write it into the custom.

### The topology problem & the chosen transfer

Stock and custom meshes have **different vertex counts / topology**, so a 1:1 per-vertex copy is impossible in
general. In practice SA tree prelit is a **near-uniform ambient tint** (foliage uses flat prelight, not baked
per-vertex AO). So the transfer is:

> Compute a **representative prelit colour** from the stock geometry (average RGBA over its prelit array) and
> **fill the custom geometry's prelit uniformly** with it — setting the `PRELIT` flag (`0x0008`) and allocating a
> `numVertices × 4` array if the custom lacks one.

This is robust to topology and is exactly "take the original's setting, apply it to the custom." A
**same-`numVertices` fast path** copies the stock prelit array verbatim (zero-cost fidelity when the custom is a
stock re-export and topology happens to match). Both live behind `--prelight`.

Per-geometry, multi-atomic DFFs handled by `collectGeometries` (same access pattern as `clearTristripFlag` /
`stripExtraVertColour`), using `decodeGeometryStruct` / `encodeGeometryStruct` from `@opensa/rw-codec/geometry-struct`
on each geometry's Struct child.

### Code touch (for the implementation)

- new `adapters/gta-sa/place/prelight.ts` — `applyStockPrelight(customDff, stockDff): Uint8Array`: for each custom
  geometry, find the matching stock geometry (by index), compute its representative colour (or copy if counts
  match), write into the custom Struct, set the `PRELIT` flag.
- `place/place-map.ts` `swapEntries` — when `prelight`, fetch stock bytes via `archive.get('<model>.dff')` and run
  `applyStockPrelight` before `swap.set`.
- `cli.ts` — `--prelight` boolean → `PlaceOptions.prelight`.

### Edge cases

- Stock model absent from the archive → skip + warn (leave custom as-is).
- Stock has no `PRELIT` flag → nothing to transfer; leave the custom untouched (don't invent white).
- Custom multi-geometry vs stock single → match by index; fall back to the stock's global average.

### Scope note

Only touches the **swapped HD DFFs**. Impostors already bake HD lighting into the atlas and use flat-white prelit
(`buildCardGeometry`), so they're unaffected. procobj species are swapped (and so prelit-transferred) only when
`--procobj` is passed — see [§C](#c---procobj-gate--implemented); otherwise they keep stock HDs and are unaffected.

---

## C. `--procobj` gate — **implemented**

### Problem

procobj handling was always on (gated only by `procObjMax > 0`, default 20 000): every `--dff ∩ procobj` species
got its scatter converted to static **and** the HD-swap deliberately _skipped_ procobj species. That mixed two
policies and gave no way to leave procobj entirely stock while still LOD-ing the regular placements.

### Fix — one explicit flag

`--procobj` is the single switch for **touching procobj species at all** — covering **both** the LOD side
(scatter → static IPL + impostor LODs) and the HD side (swap their HD DFF for the `--dff` mesh):

- **off** (default) — procobj species are left fully stock: no static conversion, no HD swap, `procobj.dat`
  untouched. Their regular streamed placements still get impostor LODs like any other `--dff` model.
- **on** — convert their scatter to static (capped by `--procobj-max`, gated by `--procobj-height`) **and** include
  them in the HD swap (safe now that the runtime scatter is gone).

### Code touch

- `place/place-map.ts` — swap list `procobj ? allPlaced : allPlaced.filter(notProcobj)`; convert gate
  `procobj && procObjMax > 0`.
- `cli.ts` `--procobj` boolean → `GtaSaTreeLodOptions.procobj` → `PlaceOptions.procobj`.

---

## Testing (A + B)

- **A** — `pickAtlasShape`: boundary at the threshold (negative: `ratio == THRESHOLD` stays square), tall→portrait
  / square→square (positive); `cards.ts` UVs with non-square `width`/`height`; `encode-txd` header + mip on a
  non-square image.
- **B** — representative-colour average; flag set + array allocated when custom lacks prelit; same-count fast-path
  copies verbatim; stock-without-prelit no-op; stock-missing skip.

Negative cases first, in their own `describe` block, per the repo test convention.
