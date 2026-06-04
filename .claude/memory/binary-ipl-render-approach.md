---
name: binary-ipl-render-approach
description: Map render approach — model catalog + InstancedMesh, and tolerant asset loading
metadata:
  node_type: memory
  type: project
  originSessionId: 9c42fe2a-bd64-4999-af30-043b1ca3dd5c
---

How map geometry (text + binary `bnry` IPL) is rendered. See [[map-pipeline]]. Plan: `.claude/plans/004-explicit-geometry-instancing.md`.

**Instancing catalog (implemented).** `map-scene.tsx` groups resolvable instances by `modelKey(def)` = `modelName|txdName` (lowercased). Each unique model → `<ModelInstances>` (`src/map/model-instances.tsx`): `useModelParts` loads the TXD + DFF **once** and calls `buildClumpParts(clump, textures)` (`src/renderware/three/build-clump.ts`) → flat single-material `RenderPart[]` (`{ geometry, material, matrix }`, native Z-up, shared vertex attributes). Each part renders one `InstancedMesh` whose per-instance matrix = `compose(position, quaternion, 1) × part.matrix`, set in `useLayoutEffect` + `computeBoundingSphere()`. This collapses the full SA map's ~36k resolvable instances / 5,119 unique models so heavy repeaters (telgrphpole02×1362, lamppost3×1338, veg_palm04×871) each draw in one call. Filters: catalog def known, `interior === 0`, `!isLodModel`.

**Model assets via one WIMG archive (current; supersedes per-asset fetch).** Plan `.claude/plans/005-img-archive.md`. Models are packed by `scripts/pack-img.mjs` (`npm run pack:img`) into `static/models/gta3.img` (our "WIMG" format — see `src/map/img-archive.ts`: 8-byte magic, u32 dir length, JSON dir `{files:{name:[relOffset,size]}}`, data). The app downloads it once via `<App>`'s `useArchiveDownload` (`loadArchive`, **per-url promise cache** — essential, else React StrictMode double-invokes the effect and fires two concurrent ~700 MB fetches that fail), shows a preloader, then passes the in-memory `ImgArchive` as a prop (no React context — avoids the R3F Canvas context-bridge gap) down to `ModelInstances`. `asset-cache.ts` `getClump`/`getTextures` read DFF/TXD **synchronously** from `archive.get(name)` (cached by name) → no per-model fetch/Suspense, no request flood. `gta.dat` IMG line → `IMG models\gta3.img` (informational; loader uses `ARCHIVE_URL` constant). `imgDirs`/`imgAssetUrl` removed. The text DAT/IDE/IPL + binary streams are still fetched normally (small count) via `use-gta-map` with tolerant `fetchTextOrNull`. Missing names in the archive (the ~7 unextracted props) → empty clump/textures → render nothing.

**Loader gotchas (learned the hard way):** cross-origin responses don't expose `Content-Length` to JS (not CORS-safelisted) → can't do a %-progress bar, preloader is indeterminate; streamed `getReader()` of a large cross-origin body was unreliable in headless → use a single `response.arrayBuffer()`.

**Remaining perf/size risk:** the full archive is **~741 MB** (14,380 dff+txd); held resident in memory after download, plus ~36k instances / 5,119 unique models for the whole map. Heavy but one download (verified end-to-end with a 173 MB LA-only subset; full needs a real browser's RAM). Volume knobs: `interior===0` (on), optional region-prefix filter (off), or pack only-referenced (~603 MB). Next perf steps: draw-distance/region streaming, geometry merge, texture atlas.
