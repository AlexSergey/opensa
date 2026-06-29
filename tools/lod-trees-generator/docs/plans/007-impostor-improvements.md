# 007 — impostor improvements (aspect-aware atlas + stock prelight transfer)

> _As-built: the CLI's `--dff`/`--txd` were unified into one `--in`; read the `--dff`/`--txd` prose below as the
> contents of `--in` (see [002](./002-build-pipeline.md))._

Two quality fixes for the placed assets. Independent. Both **implemented** (§A, §B).

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

### The transfer — trunk-only, on both HD and LOD

Stock and custom meshes have **different vertex counts / topology**, so a 1:1 per-vertex copy is impossible. SA
tree prelit is a **near-uniform ambient tint** anyway, so we take **one representative colour** from the stock
prelit (mean RGBA over its prelit vertices — `stockPrelightColor`).

It is applied **only to the trunk**, not the foliage: a flat ambient over alpha-cutout leaves muddies them, and
the foliage texture already reads well. Trunk vs foliage is classified by **texture alpha** — opaque = trunk/bark,
alpha-cutout = foliage (`DecodedTexture.hasAlpha`, the `--txd` set). So:

- **trunk** vertices/pixels → the stock ambient colour.
- **foliage** vertices/pixels → keep the custom's own prelit (white when it had none).

Crucially this runs on **both surfaces so they stay consistent**:

- **HD DFF** (`applyStockPrelight`, shared `@opensa/sa-lod/prelight`) — per geometry, decode the Struct, and fill `prelit` via
  `trunkOnlyPrelit(numVertices, existing, average, foliageMask)`; set the `PRELIT` flag. The foliage mask comes
  from `parseDff` materials (texture name → `isFoliage`), defaulting to all-trunk if the DFF won't parse.
- **LOD atlas** (`applyTrunkPrelight`, `io.ts`) — the bake multiplies texture × vertex prelit, so the impostor
  inherits whatever prelit the source carries. Without this it baked from the custom's **uncorrected** (often
  bright) prelit → LOD much brighter than the now-darkened HD. So when `--prelight`, the adapter recolours trunk
  triangles to the same stock ambient before baking; foliage triangles keep their source colours.

### Code touch

- `@opensa/sa-lod/prelight` (shared with `lod-procobj-generator`) — `applyStockPrelight(customDff, stockDff,
isFoliage)`, plus exported `stockPrelightColor`, `trunkOnlyPrelit`, and `parsePrelightInfo`/`PrelightInfo`.
- `io.ts` — `applyTrunkPrelight(tree, colour)` (LOD-bake trunk recolour; HdTree-specific, stays in this tool).
- `adapters/gta-sa/index.ts` — build the `foliageTextures` set (`hasAlpha`); in the adapter's `loadTree`, when
  `--prelight`, compute the stock trunk colour and `applyTrunkPrelight` the baked tree; pass `foliageTextures` to
  `placeMap`.
- `place/place-map.ts` `swapEntries` — when `prelight`, fetch stock bytes via `archive.get('<model>.dff')` and run
  `applyStockPrelight(..., (n) => foliageTextures.has(n))` before `swap.set`.
- `cli.ts` — `--prelight` boolean.

### Per-model overrides — `--prelight <info.json>`

`--prelight` optionally takes a JSON file of per-model overrides (`@opensa/sa-lod/prelight` `parsePrelightInfo` →
`PrelightInfo { skip }`). Today the only knob is **`skip`** — a model listed `{ "<model>": { "skip": true } }` is
opted **out** of the transfer entirely: its HD is packed **verbatim** (`swapEntries` skips `applyStockPrelight`)
and its LOD is baked from its own prelit (`loadTree` skips `applyTrunkPrelight`). Bare `--prelight` (no path) keeps
the apply-to-all default. The object-per-model shape leaves room for more knobs later. (e.g. a custom-tree whose
own prelit is correct, where the stock-ambient overwrite would look wrong.)

### Edge cases

- Stock model absent from the archive → skip + warn (leave custom as-is).
- Stock has no `PRELIT` → `stockPrelightColor` is null; nothing transferred, LOD bake unchanged (HD and LOD both
  use the source prelit → still consistent).
- Custom DFF unparseable for materials → foliage mask falls back to all-trunk (prelight applies everywhere).

### Scope note

Only touches the **swapped HD DFFs** and their **LOD atlas**. Non-`--prelight` runs are unchanged. procobj species
are never swapped here (they keep their stock HD + runtime scatter), so they're unaffected — their LODs are a
separate tool (`lod-procobj-generator`).

---

## Testing (A + B)

- **A** — `pickAtlasShape`: boundary at the threshold (negative: `ratio == THRESHOLD` stays square), tall→portrait
  / square→square (positive); `cards.ts` UVs with non-square `width`/`height`; `encode-txd` header + mip on a
  non-square image.
- **B** — representative-colour average; flag set + array allocated when custom lacks prelit; same-count fast-path
  copies verbatim; stock-without-prelit no-op; stock-missing skip.

Negative cases first, in their own `describe` block, per the repo test convention.
