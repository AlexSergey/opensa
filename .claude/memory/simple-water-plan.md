---
name: simple-water-plan
description: Plan 014 — render GTA SA water.dat as a flat textured surface (no shader yet)
metadata:
  type: project
---

Plan: `.claude/plans/014-simple-water.md`. Render water from `static/data/water.dat` as a **flat textured surface** across the map, using `waterclear256` from `static/models/particle.txd`. **No water shader** (that's a much later task) — just a textured `MeshBasicMaterial` plane.

**Verified everything is present:** `water.dat` = `processed` header + **307 quads**; each line = **4 (or 3) vertices × 7 floats** (`x y z` + 4 extra normal/flow) + a type flag → `vertexCount = (tokens−1)/7`; we use only the corner positions, `z` = water height (mostly 0 = sea, some lakes higher). `particle.txd` parses (34 textures, **all rgba8888**, supported); has **`waterclear256` 128×128** (the surface) + `waterwake`. Reuse `parseTxd`→`buildTextureMap` + the persistent **−90°X `streamingRoot`** to parent the mesh.

**Design:** `parseWater(text) → WaterQuad[]` (renderware/parsers/text); `buildWater(quads, texture) → THREE.Mesh` (one merged BufferGeometry, quad→2 tris, **tiled world-X/Y UVs** with RepeatWrapping, `MeshBasicMaterial` textured + transparent ~0.7 + DoubleSide; native Z-up). `WorldAdapter.loadWater(waterUrl, txdUrl)` (adapter fetches + parses + builds); bootstrap adds it under `game.getStreamingRoot()` (already −90°X; streaming only removes its own cell objects, so a permanent child is safe). ~307 quads = one draw call.

**Iter 1 DONE:** `renderware/parsers/text/water.parser.ts` `parseWater(text) → WaterQuad[]` (`{vertices:[x,y,z][]}`); skips `processed`/blank, `vertexCount=(tokens−1)/7`, keeps positions only. Barrel-exported, 3 tests. Real `water.dat`: 307 polys (301 quads + 6 tris). 199 tests green.

**Iter 2 DONE:** `renderware/three/build-water.ts` `buildWater(quads, texture) → THREE.Mesh` — merged BufferGeometry (quad→2 tris, tri→1), tiled world-X/Y UVs (`TILE 16`), `MeshBasicMaterial` (transparent 0.7, DoubleSide, depthWrite:false), texture `wrapS/wrapT=RepeatWrapping`. Barrel-exported, 2 tests. 201 tests green.

**Iter 3 DONE (code; browser pending):** `WorldAdapter.loadWater(waterUrl, txdUrl)` + GtaSaWorldAdapter impl (`fetchText` water.dat + `fetchBuffer` particle.txd → `parseWater` + `buildTextureMap(parseTxd).get('waterclear256')` [keys lowercased, verified] → `buildWater`). Bootstrap adds it under `game.getStreamingRoot()` (−90°X). 201 tests green. **Note:** spawn (Ganton) is inland/above sea (z=0) — go to coast/lake to see water. Tunables: `TILE` (UV), opacity/tint, `depthWrite:false`.

**Horizon fix:** `water.dat` only covers the map, so `loadWater` now builds the **ocean as one big sea-level plane** (`SEA_LEVEL 0`, `SEA_HALF 16000`) reaching the horizon, and keeps only the file's **non-sea-level lakes** (|z|>0.5) on top (sea-level file polys dropped to avoid double-blend). Remaining caveat: with no fog/skybox the ocean clips at the camera far plane (~8000) as a hard circle — fix later with fog/skybox (atmosphere task), not part of simple water. Tunables: `TILE` (UV scale ~16), opacity/tint. Out of scope: the water shader (waves/reflection/scroll), swimming/buoyancy, underwater tint, flow params, culling.

**Tunnel-flood fix (DONE, plan 014 iter 4):** the first version replaced ALL sea-level water.dat polys with
one 32000² plane at z=0 → it covered low ground/tunnels-under-land that the real data doesn't, so those
tunnels looked flooded. Now `loadWater` renders the **real** water.dat quads (all of them) + an **ocean
frame**: `oceanFrame(quads, SEA_HALF=16000, SEA_LEVEL=0)` in `build-water.ts` returns up to 4 sea-level
border quads = the big plane minus a hole cut to the data's bounding box (degenerate strips skipped). Real
water fills the map (correct coverage), the frame is open ocean to the horizon. `oceanFrame` barrel-exported;
`build-water.test.ts` covers it (4 strips / degenerate-skip / empty→full-plane).
