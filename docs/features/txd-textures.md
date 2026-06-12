# TXD parser + textures

`src/renderware/parsers/binary/txd.ts`, `src/renderware/three/build-texture.ts`,
`src/renderware/archive/asset-cache.ts` (txdp resolution).

## Implemented

- TXD texture-native parsing: name/mask, dimensions, mip levels, alpha flag.
- Pixel formats: **DXT1 / DXT3 / DXT5** (uploaded compressed via `CompressedTexture` +
  S3TC formats), **RGBA8888/X8R8G8B8** (`DataTexture`), **16-bit R5G6B5 / A1R5G5B5 /
  A4R4G4B4** (expanded to RGBA8888 at parse, plan 043), and **PAL8/PAL4** palettized
  (expanded at parse).
- `buildTextureMap`: name-keyed (lowercased) `Map<string, Texture>` per TXD; `hasAlpha` carried
  in `userData` (drives material transparency/alpha-test).
- **txdp inheritance** (`parseTxdParents` + `resolveTxdChain`): a child TXD inherits textures it
  lacks from its parent chain (child wins), cycle-guarded, memoized per name. Required by the
  optimized/modded maps that hoist shared textures into regional `*_gene` parents.
- sRGB handling: world textures flow through the colour-managed pipeline; timecyc-driven
  uniforms decode 0–255 sRGB explicitly where needed (see world-lighting).

## Coverage (audit 2026-06-12, `scripts/audit-rw-coverage.ts`)

22705 textures across the shipped TXDs parse successfully; **36 dropped (0.16%)** — the 16-bit
rasters below. Shipped format distribution: dxt1 20790, dxt5 1867, dxt3 44, rgba8888 4 (palettes
expand to rgba8888 at parse).

## Known gaps / candidates

- Luminance (LUM8) rasters unsupported (none confirmed in shipped data; the audit's residual
  drop count after the 16-bit fix tells the truth).
- Mipmaps beyond the base are uploaded for compressed textures but not validated individually.
- No software decode in the runtime (only `scripts/dump-texture.ts` decodes DXT in JS for
  inspection).
- Per-texture/material `0x1F` = RW **Right To Render** (pipeline hint, ×56k) — identified via
  the gtamods section list; harmless skip, nothing to implement.

## Test coverage anchors

`loaders.test.ts` (legacy loader wrappers), texture resolution through archive tests; txdp chain
tests in `asset-cache.test.ts`.
