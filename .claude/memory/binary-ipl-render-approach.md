---
name: binary-ipl-render-approach
description: Map render approach — model catalog + InstancedMesh, and tolerant asset loading
metadata:
  node_type: memory
  type: project
  originSessionId: 9c42fe2a-bd64-4999-af30-043b1ca3dd5c
---

How map geometry (text + binary `bnry` IPL) is rendered. See [[map-pipeline]]. Plan: `.claude/plans/004-explicit-geometry-instancing.md`.

> **Note (post engine refactor):** this is now imperative, not R3F. The logic below lives in `src/renderware/map/build-region.ts` (`buildRegion`) + `src/renderware/archive/`; the archive download/bootstrap is in `src/ui/canvas-host.tsx`. The facts (modelKey grouping, conjugate-quat, WIMG format, StrictMode promise cache) are unchanged — only the host changed. See [[engine-refactor-status]].

**Instancing catalog (implemented).** `buildRegion` groups resolvable instances by `modelKey(def)` = `modelName|txdName` (lowercased). Per unique model it calls `buildClumpParts(getClump(...), getTextures(...))` (`src/renderware/three/build-clump.ts`) → flat single-material `RenderPart[]` (`{ geometry, material, matrix }`, native Z-up, shared vertex attributes). Each part → one `InstancedMesh` whose per-instance matrix = `compose(position, quaternion, 1) × part.matrix`. **GTA SA IPL quaternions are the inverse of three.js's convention → `quat.conjugate()` before composing** (without it, yawed objects faced/sat wrong — e.g. a telegraph pole on the wrong side of the road, a stadium plaza at the wrong angle; 180°/identity rotations are conjugate-invariant so they looked fine and masked the bug). This collapses the full SA map's ~36k resolvable instances / 5,119 unique models so heavy repeaters (telgrphpole02×1362, lamppost3×1338, veg_palm04×871) each draw in one call. Filters: catalog def known, `interior === 0`, geometry kind (`!isLodModel` for `map`), radius around `center`. Each mesh carries `userData.region = { def, instances }` for click-inspect (the adapter's `describe`).

**Model assets via one WIMG archive (current; supersedes per-asset fetch).** Plan `.claude/plans/005-img-archive.md`. Models are packed by `scripts/pack-img.mjs` (`npm run pack:img`) into `static/models/gta3.img` (our "WIMG" format — see `src/renderware/archive/img-archive.ts`: 8-byte magic, u32 dir length, JSON dir `{files:{name:[relOffset,size]}}`, data). It's downloaded once by `GtaSaWorldAdapter.prepare()` via `loadArchive` (**per-url promise cache** — essential, else React StrictMode double-invokes the bootstrap and fires two concurrent ~700 MB fetches that fail); the `ui/canvas-host` bootstrap is itself a module-scope promise (StrictMode-safe) and shows an indeterminate preloader. `archive/asset-cache.ts` `getClump`/`getTextures` read DFF/TXD **synchronously** from `archive.get(name)` (cached by name) → no per-model fetch, no request flood. `gta.dat` IMG line → `IMG models\gta3.img` (informational; the adapter is configured with the archive URL). The text DAT/IDE/IPL + binary streams are still fetched normally (small count) in `resolveMap` with tolerant `fetchTextOrNull`. Missing names in the archive (the ~7 unextracted props) → empty clump/textures → render nothing.

**Loader gotchas (learned the hard way):** cross-origin responses don't expose `Content-Length` to JS (not CORS-safelisted) → can't do a %-progress bar, preloader is indeterminate; streamed `getReader()` of a large cross-origin body was unreliable in headless → use a single `response.arrayBuffer()`.

**Remaining perf/size risk:** the full archive is **~741 MB** (14,380 dff+txd); held resident in memory after download, plus ~36k instances / 5,119 unique models for the whole map. Heavy but one download (verified end-to-end with a 173 MB LA-only subset; full needs a real browser's RAM). Volume knobs: `interior===0` (on), optional region-prefix filter (off), or pack only-referenced (~603 MB). Next perf steps: draw-distance/region streaming, geometry merge, texture atlas.
