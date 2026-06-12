# IMG archive + asset cache

`src/renderware/archive/` — `img-archive.ts`, `asset-cache.ts`, `model-key.ts`,
`resolve-paths.ts`.

## Implemented

- Stock **GTA VER2 IMG** reader (`openArchive` over a buffer, `loadArchive` over fetch):
  directory of 2048-byte sectors, case-insensitive name lookup, `names` iteration. Same format
  the game and mods use, so original and modded archives are interchangeable.
- `buildArchiveBuffer` / `buildVer2Buffer` for tests and tools (writer side).
- Asset cache (module-level, keyed by lowercased name):
  - `getClump` — parsed DFFs; absent/unparseable → empty clump (renders nothing, never throws).
  - `getTextures` — TXDs resolved through the **txdp parent chain**.
  - `getIfp` — IFP animation packages (zone object clips), absent → empty list.
- URL helpers (`datChildUrl`, `iplBasename`, `streamIplUrl`, `standaloneIplUrl`,
  `normalizeDatPath`).
- Build tooling: `scripts/pack-img.mjs` (multi-folder override packing),
  `scripts/pack-anim-img.mjs`, manifest generation for stream IPLs.

## Known gaps / candidates

- VER1 (GTA3/VC dir+img pair) not supported — not needed for SA.
- No eviction in the asset caches (bounded by archive content; fine for a single world).

## Test coverage anchors

`img-archive.test.ts`, `img-archive.fixture.test.ts`, `asset-cache.test.ts`,
`model-key.test.ts`, `resolve-paths.test.ts`.
