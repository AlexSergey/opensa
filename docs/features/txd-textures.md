# TXD parser + textures

`src/renderware/parsers/binary/txd.ts`, `src/renderware/three/build-texture.ts`,
`src/renderware/archive/asset-cache.ts` (txdp resolution).

## Implemented

- TXD texture-native parsing: name/mask, dimensions, mip levels, alpha flag.
- Pixel formats: **DXT1 / DXT3 / DXT5** (uploaded compressed via `CompressedTexture` +
  S3TC formats) and **RGBA8888** (`DataTexture`).
- `buildTextureMap`: name-keyed (lowercased) `Map<string, Texture>` per TXD; `hasAlpha` carried
  in `userData` (drives material transparency/alpha-test).
- **txdp inheritance** (`parseTxdParents` + `resolveTxdChain`): a child TXD inherits textures it
  lacks from its parent chain (child wins), cycle-guarded, memoized per name. Required by the
  optimized/modded maps that hoist shared textures into regional `*_gene` parents.
- sRGB handling: world textures flow through the colour-managed pipeline; timecyc-driven
  uniforms decode 0–255 sRGB explicitly where needed (see world-lighting).

## Known gaps / candidates

- Paletted (PAL8/PAL4) rasters not supported (none encountered in shipped data so far).
- Mipmaps beyond the base are uploaded for compressed textures but not validated individually.
- No software decode in the runtime (only `scripts/dump-texture.ts` decodes DXT in JS for
  inspection).

## Test coverage anchors

`loaders.test.ts` (legacy loader wrappers), texture resolution through archive tests; txdp chain
tests in `asset-cache.test.ts`.
