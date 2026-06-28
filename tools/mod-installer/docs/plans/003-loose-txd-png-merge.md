# 003 — mod-installer: merge PNG folders into loose `.txd`

**Plan only — implement after.** Extend `applyMod` so a mod can patch a **loose** `.txd` (a `.txd` file on disk,
**not** one inside an `.img`) by shipping a **folder of PNGs** in its place. Mirrors the existing `gta3img/` →
`gta3.img` merge, but for standalone texture dictionaries.

## The rule

While applying a mod, if the mod contains a **directory** `…/<name>` whose sibling `…/<name>.txd` already exists
as a **loose file** in `--out` (the base, or an earlier mod, or this mod's own file copy), then **do not copy the
folder**. Instead, read the **PNG** files inside it and merge them into that `<name>.txd`:

- a PNG whose base name matches an existing texture → **replace** it,
- a PNG with a new name → **add** it,
- every other texture in the `.txd` is left untouched.

Applies anywhere in the tree, at any depth. Examples (base = `non-modified`):

```
mod/models/particle/          → merges into  out/models/particle.txd          (particle.txd exists in base)
mod/models/generic/vehicle/   → merges into  out/models/generic/vehicle.txd
```

Non-PNG files inside a matched folder are ignored (with a warning). `gta3.img`-internal textures are **out of
scope** here — those keep going through the `gta3img/` path.

## Encoding pipeline (one PNG → one TextureNative)

All building blocks already exist in `@opensa/rw-codec` (and are how the LOD tools build TXDs):

1. **Decode PNG** → RGBA + `width`/`height`. **Hand-rolled with `fflate`** (`unzlibSync` + un-filter), local
   `png-decode.ts` — no new dependency, mirroring how lod-trees hand-rolls PNG **encode** with fflate. Supports
   8-bit colour types **2 (RGB)** and **6 (RGBA)** with all five scanline filters; throws a clear error on
   palette / 16-bit / interlaced (rare for mod textures; a follow-up). Round-trip-tested against lod-trees'
   `encodePng`.
2. **Pick the format** — scan the alpha channel: any pixel `a < 255` ⇒ **DXT5** (full alpha), else **DXT1**
   (opaque). Covers the user's "альфа канал" case (particle.txd needs DXT5, vehicle.txd is mostly DXT1).
3. **Mip chain** — `buildMipChain(rgba, w, h)` (`@opensa/rw-codec/mip`) → RGBA levels down to 1×1 (2×2 box).
4. **Compress** — `encodeDxt(format, level.data, level.width, level.height)` (`@opensa/rw-codec/dxt-encode`) per
   level → DXT blocks.
5. **Struct** — write a RenderWare TextureNative **struct** from scratch: `platform u32, filter u32, name[32],
maskName[32], rasterFormat u32, d3dFormat u32, width u16, height u16, depth u8, numLevels u8, rasterType u8,
flags u8`, then per level `size u32 + dxt-bytes` (the layout `encodeRgba8888Struct` documents and that
   `txd.ts`/lod-trees' `encodeDxt5Struct` already produce). **Add a shared `encodeDxtStruct(name, format, levels)`
   to `@opensa/rw-codec/texture-native.ts`** — a from-scratch builder (the existing `encodeRgba8888Struct` /
   `encodeSameFormatStruct` both need an _original_ struct to copy 72 bytes from; ADD has none). lod-trees'
   private `encodeDxt5Struct` can later be deduped onto it.
6. **Wrap** — `{ type: RW_TEXTURE_NATIVE, children: [{ type: RW_STRUCT, data: struct }, { type: RW_EXTENSION }] }`
   (exactly the `encodeAtlasTxd` shape), at the dictionary's RW `version`.

## TXD container merge (add / replace by name)

Same round-trip pattern as `map-optimizer`'s `optimizeTxd`:

1. `readRw(txdBytes)` → find the `RW_TEXTURE_DICTIONARY` chunk; its children are `RW_STRUCT` (count + deviceId)
   then N × `RW_TEXTURE_NATIVE` then `RW_EXTENSION`.
2. Index existing natives by `readTextureName(struct.data)` (lower-cased).
3. For each PNG → build a TextureNative (above). If its name matches → **replace** that child; else **append**.
4. Update the dictionary `RW_STRUCT` header's `textureCount` (`u16` at offset 0) to the new native count. (Chunk
   sizes are recomputed by `writeRw`, so only the count field is hand-written.)
5. `writeRw(file)` → write back to `<name>.txd`. Reuse the dictionary's RW `version` for the new natives so the
   file stays consistent.

## Modules

```
tools/mod-installer/src/
  png-decode.ts     decodePng(bytes) → { width, height, rgba }            (fflate unzlib + un-filter; types 2/6)
  png-texture.ts    pngToTextureNative(name, pngBytes, version) → RwChunk  (decode → format → mips → dxt → struct)
  txd-folder.ts     mergeTxdFolder(folderPath, txdPath) → number           (parse dict, add/replace by name, write)
  apply-mod.ts      walk recursively; a dir with a sibling <dir>.txd in --out → mergeTxdFolder instead of copy
```

Plus one shared addition: `encodeDxtStruct` in `@opensa/rw-codec/texture-native.ts` (type:tool → type:tool is
allowed).

`apply-mod.ts` changes from a shallow top-level `cpSync` loop to a recursive walk so nested folders
(`models/generic/vehicle/`) are detected. Within each directory: copy plain **files** first, then process
**subdirectories** (so a mod that also ships the `.txd` file has it in place before a sibling folder merges into
it). `gta3img/` stays a top-level special case, merged last (unchanged).

## Decisions

1. **Loose `.txd` only** — detection is "sibling `<dir>.txd` exists as a file in `--out`". Textures inside
   `gta3.img` are not touched (that's the `gta3img/` path).
2. **Format per PNG** — DXT5 if the PNG has real alpha, else DXT1. (DXT3 not emitted; rare in SA.) Mipmaps always
   generated (full chain) — matches stock SA textures.
3. **Replace vs add** — by texture name = PNG base name (case-insensitive), like the IMG merge by entry name.
4. **Folder wins are last-write** — later mods' folders re-merge into the now-updated `.txd`.

## Assumptions (not blocking)

- **Dimensions** are a multiple of 4 (DXT block size); power-of-two recommended (stock SA textures are). Non-PoT
  may render oddly; validate ×4 and throw a clear error otherwise.
- **8-bit RGBA PNGs** (colour type 6 / 2). pngjs handles palette/greyscale → RGBA; 16-bit is downcast.
- A matched folder holds **only** texture PNGs; other files are skipped with a warning (no stray folder copied).
- `version` for new natives = the target dictionary's version (read from its chunk). A fresh `.txd` is not seeded
  here — the rule requires the `.txd` to already exist (unlike `gta3img/`, which can seed). New-`.txd` seeding is a
  follow-up if needed.

## Task plan (phases)

1. **PNG → TextureNative** ✅ — `png-decode.ts` (fflate) + `png-texture.ts` + shared `encodeDxtStruct`
   (`@opensa/rw-codec/texture-native`). Tests: opaque → DXT1, alpha → DXT5, name + size + mip count via `parseTxd`;
   decode round-trips all 5 filters + RGB/RGBA (PNGs synthesised with the `encodePng` test helper).
2. **TXD merge** ✅ — `txd-folder.ts`: build a tiny `.txd` via phase 1, merge a folder that **adds** + **replaces**;
   asserts names, the untouched texture survives, and the replaced one changed size.
3. **apply-mod walk** ✅ — `apply-mod.ts` is now a recursive walk (files first, then subfolders) with txd-folder
   detection; `gta3img/` + file-overlay behaviour unchanged (existing tests stay green).
4. **e2e** ✅ — `install.e2e.test.ts`: a mod's nested `models/generic/vehicle/` PNG folder over a base `vehicle.txd`
   → folder not copied, dictionary replaced/added the right textures, still parses (`parseTxd`).
5. **Docs** ✅ — `readme.md` updated. `tsc`/`eslint`/tests green (mod-installer 21, rw-codec unaffected; map-optimizer
   - lod-trees still green after the shared `encodeDxtStruct` addition).

## Risks

- **Struct header correctness** — wrong rasterFormat/flags/depth makes SA reject the texture. Mitigation: mirror
  the exact bytes `encodeDxt5Struct` (lod-trees, shipped + in-game-verified) writes, generalised to DXT1, and
  round-trip through `parseTxd` in tests.
- **`encodeDxt` size handling** — confirm it pads non-4-multiple dimensions (or gate on ×4).
- **Hand-rolled PNG decode** — covers 8-bit RGB/RGBA (the mod-texture norm); palette/16-bit/interlaced throw
  (follow-up). Validated by a round-trip against lod-trees' `encodePng`.

## Reuse map (no new dependency)

`@opensa/rw-codec`: `chunk` (`readRw`/`writeRw` + `RW_*`), `mip` (`buildMipChain`), `dxt-encode` (`encodeDxt`),
`texture-native` (`readTextureName`, new `encodeDxtStruct`). `@opensa/renderware/parsers/binary/txd` (`parseTxd`)
for test assertions. `fflate` (already a dep) for PNG inflate. Reference: `map-optimizer` `optimizeTxd`
(round-trip) + lod-trees `encode-txd.ts` (from-scratch natives) + `core/png.ts` (`encodePng`).
