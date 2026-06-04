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

**Tolerant loading (important).** `gta.dat` references files that may not be extracted (e.g. it lists `MODELS\*.IMG`, `TXDCUT.IDE`, `.ZON`), and the catalog can name models whose `.dff`/`.txd` aren't in `img/gta3`. R3F `useLoader`/`use()` throwing on a 404 bypasses `<Suspense>` and blanks the whole app. So ALL asset fetches are wrapped: `useClump`/`use-textures.ts` return an empty clump / empty texture map on `!ok` **or** a thrown `fetch` (network errors happen under the load of thousands of requests); `use-gta-map`'s `fetchTextOrNull` + binary-stream probe swallow failures. Missing assets render nothing instead of crashing. (Replaced the old `useLoader(TXDLoader)` path with the stateless cached `useTextures` to also dodge the shared-mutable-loader texture race.)

**Remaining perf risk:** loading the *whole* San Andreas (LA+SF+vegas+country ≈ 5k unique DFF fetches) is heavy on network/memory. Volume knobs available: `interior===0` (on) and an optional region-prefix filter (off). Next perf steps if needed: draw-distance/region streaming, geometry merge, texture atlas — out of scope for now.
