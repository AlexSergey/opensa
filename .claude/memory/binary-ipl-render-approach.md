---
name: binary-ipl-render-approach
description: Current binary-IPL map render approach and the planned catalog/instancing rework
metadata: 
  node_type: memory
  type: project
  originSessionId: 9c42fe2a-bd64-4999-af30-043b1ca3dd5c
---

How binary-stream IPL geometry is rendered today (and what must change). See [[map-pipeline]].

**Current approach (per-instance build):** `useGtaMap` collects ~1,200–1,450 resolvable instances (text IPL + binary `bnry` streams from `static/ipl_binary/`). In `map-instance.tsx`, **each** instance independently `useLoader(TXDLoader)` + `useClump` (cached DFF parse) and runs `buildClump(clump, textures, { convertToYUp:false })` in `useMemo`, producing its own `THREE.Group` + `<primitive>`. Fetches/parses are deduped by url (module caches), but **geometry/materials are rebuilt per instance** → ~1,200+ separate BufferGeometries and draw calls even though the same model id repeats heavily across the map.

**Planned rework → model catalog + instancing.** Build each unique model (dff+txd) **once** into a cached prototype keyed by model name/id (a "catalog"), then place many instances by reusing it — `mesh.clone()` for the simple case, or `InstancedMesh` per model for the big win (one draw call per model, per-instance matrices for position/rotation). This collapses ~1,200 draw calls to ~(number of unique models) and removes redundant `buildClump` work.

**Why:** the per-instance approach was the simplest correct path (and it fixed the shared-mutable-`DFFLoader` texture race by going through `useClump`+`buildClump`), but it doesn't scale — visible as heavy GPU memory / draw-call count when the whole LA region loads. The catalog/instancing pass is the agreed next step (user-confirmed). Keep the parser/walker data model unchanged; this is purely a rendering-layer change in `src/map/`.
