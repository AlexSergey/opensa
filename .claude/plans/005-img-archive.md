# Custom IMG archive — single-file download + in-memory unpack

## Context

Rendering the map currently issues ~10k individual HTTP requests (one per `.dff`/`.txd`). Under that
flood the dev server drops connections → `fetch` rejects with "Failed to fetch" → React `use()`
throws past `<Suspense>` → the whole app blanks. We worked around it with tolerant fetches, but the
real fix is to ship the assets as **one archive**, download it once (with a preloader), unpack it in
memory, and resolve models from RAM instead of the network.

### Measured facts
- `static/img/gta3` = **776 MB** / 14,659 files (12,217 dff, 2,163 txd, 215 col, 64 dat).
- The map references **5,823** unique dff + **1,372** txd; only **7** are genuinely missing
  (gym/RC interior props) → archiving fixes the crash, since it was request-flood, not missing files.
- Referenced present files ≈ **603 MB** (dff+txd only).

## Archive format ("WIMG" — our own, JS-friendly)

```
[8 bytes]  magic ASCII "WIMG0001"
[u32 LE]   directoryLength
[dir]      UTF-8 JSON, directoryLength bytes:
             { "files": { "<lowercased name>": [relativeOffset, size], ... } }
[data]     concatenated raw file bytes
```
`relativeOffset` is from the **start of the data section** (`dataStart = 12 + directoryLength`), so
offsets don't depend on the directory's own byte size (no circular sizing). Lookup is O(1) by
lowercased filename. JSON dir for ~14k files ≈ 0.5 MB — negligible vs the data.

Reasons over real GTA IMG v2: no 2048-byte sector alignment math, directory is trivially parsed in
the browser, and we only carry what we need (dff+txd).

## Packing script (`scripts/pack-img.mjs`, npm `pack:img`)

- Read `static/img/gta3`, take `.dff` + `.txd` (skip `.col`/`.dat` — renderer doesn't use them).
- Pass 1: `statSync` each → build directory with cumulative `relativeOffset`.
- Write header + JSON dir, then **stream** each file's bytes in directory order (600 MB → never hold
  in memory; `fs.createReadStream` → `createWriteStream`, `pipeline(..., { end:false })`).
- Output `static/gta3.img`. Print count + size.
- (Optional flag `--all` to include every file; default dff+txd.)

## Runtime: download + preloader + in-memory unpack (`src/map/`)

- `img-archive.ts`:
  - `type ImgArchive = { get(name: string): ArrayBuffer | null }`.
  - `loadArchive(url, onProgress)`: `fetch` → read `response.body.getReader()` chunks, summing bytes
    against `Content-Length` for progress; concat into one `Uint8Array`; parse magic + dir;
    `get(name)` = `buffer.slice(dataStart+offset, +size)` (a small per-file copy; the 600 MB stays
    resident once). Returns null for names not present (the 7 missing → render nothing).
- `archive-context.tsx`: React context holding the loaded `ImgArchive`.
- `archive-gate.tsx`: downloads on mount with `useState` progress, shows a **preloader** (percent
  bar) until ready, then renders children inside the context provider. (Progress needs real state —
  `<Suspense>` can't show percent — so this is a normal stateful component, not `use()`.)
- Rewire model loading to read from the archive instead of the network:
  - `useClump(name)` / `useTextures(name)` become **synchronous** memoized lookups: `archive.get(name)`
    → `parseDff` / `parseTxd`+`buildTextureMap`, cached by name in a module map. No per-model fetch,
    no per-model `<Suspense>`. Missing name → empty clump / empty map (keeps the 7-missing tolerant).
  - `use-model-parts.ts` pulls the archive from context and builds parts from the cached clump+textures.
  - `map-instance`/`map-scene` no longer wrap each model in `<Suspense>` (nothing suspends per model).
- `app.tsx`: wrap `<MapScene>` in `<ArchiveGate url={`${BASE}/gta3.img`}>`; the gate's preloader
  replaces the blank load. Keep the Ganton `focus`.

## gta.dat

Point the IMG directive at the archive instead of the loose folder:
`IMG IMG\gta3` → `IMG gta3.img`. Note: with the archive, the loader resolves models by **name from
the archive**, so the DAT IMG line becomes informational; the archive URL is `${BASE}/gta3.img`.
`imgDirs[0]` is no longer used for model paths (drop the per-model `imgAssetUrl`).

## Does this fix tolerant loading?

Yes — the crashes came from the request flood (thousands of concurrent fetches), not missing files
(only 7/7200). One sequential download removes the flood entirely. We still return null for the 7
genuinely-absent names so they render nothing rather than throw.

## Tests

- `img-archive` round-trip (node): pack a few synthetic entries, parse the buffer, assert
  `get(name)` returns exact bytes and unknown name → null. (Reuse the packing layout in a tiny pure
  `buildArchive(entries)` helper so it's testable without 600 MB.)
- Existing parser/instancing suites stay green.

## Verification

1. `npm run pack:img` → `static/gta3.img` (~600 MB); `lint`/`tsc`/`vitest` green.
2. End-to-end: `serve:static` + `dev` → preloader shows download %, then Ganton renders fully
   (same as now) with **no per-asset requests** in the network panel and no "Failed to fetch".

## Out of scope

Real IMG v2 compatibility, compression (gzip the archive via server is possible later), `.col`
collision, streaming/partial archive download, and the 7 missing interior props (need extraction).
