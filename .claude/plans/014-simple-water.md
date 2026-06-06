# 014 — Simple water (flat textured surface, no shader)

## Goal

Render GTA SA's water as a **flat, textured surface** across the whole map from `static/data/water.dat`,
covered with the `waterclear256` texture from `static/models/particle.txd`. **No water shader** — just a lit-
agnostic textured plane (a real animated/reflective water shader is a much later task). This gives the sea +
lakes a visible surface at their correct heights.

## What we have (verified — everything needed is present)

- `static/data/water.dat`: line 1 `processed`, then **307 water quads**. Each line = **4 (or 3) vertices ×
  7 floats** (`x y z` + 4 extra: normal / flow / wave params) + a trailing **type flag**; vertex count =
  `(tokens − 1) / 7`. We only need the corner **positions**; `z` is the water height (mostly `0` = sea level,
  some lakes higher). Plain text → a tiny new parser.
- `static/models/particle.txd`: parses fine (34 textures, **all RGBA8888** — fully supported by our TXD
  parser). Contains **`waterclear256` (128×128)** — the water-surface texture — and `waterwake`.
- Existing pipeline reused: `parseTxd` → `buildTextureMap` (TXD → `THREE.Texture`), three geometry building,
  and the `streamingRoot` (a persistent **−90°X** GTA-Z-up group already in the scene) to parent the mesh.

**Conclusion: nothing missing.** No shader, no new assets.

## Design

- **Parse** `water.dat` → `WaterQuad[]` (`{ vertices: Vec3[] }`, 3 or 4 corners; positions only). Renderer-
  agnostic, in `renderware/parsers/text`.
- **Build one merged mesh** (`renderware/three/build-water.ts`): all quads → a single `BufferGeometry`
  (positions + an index; a quad = 2 triangles, a triangle = 1; winding so the surface faces up / use
  `DoubleSide`). **UVs tile from world X/Y** (`u = x / TILE`, `v = y / TILE`) so the texture repeats across
  the map (`RepeatWrapping`). One `MeshBasicMaterial` (no lighting, like the unlit water look): `map =
  waterclear256`, `transparent`, `opacity ≈ 0.7`, `side: DoubleSide`, optional slight blue tint. Native
  Z-up (the caller's `streamingRoot` applies the −90°X). ~307 quads → ~1.2k verts: trivial, one draw call.
- **Adapter seam** `WorldAdapter.loadWater(waterUrl, txdUrl): Promise<Object3D>` (`game/adapters`): fetch +
  `parseWater` + `parseTxd`/`buildTextureMap` + `buildWater`. The bootstrap adds the result under
  `game.getStreamingRoot()` (already −90°X; the streaming system only removes its own cell objects, so a
  permanent child is safe).

## Module touch list

```
src/renderware/parsers/text/water.parser.ts   # parseWater(text) -> WaterQuad[] (+ barrel export)
src/renderware/three/build-water.ts           # buildWater(quads, texture) -> THREE.Mesh (+ barrel export)
src/game/interfaces/world-adapter.interface.ts # + loadWater(waterUrl, txdUrl): Promise<Object3D>
src/game/adapters/gta-sa-world.adapter.ts       # implement loadWater (fetch + parse + build)
src/ui/canvas-host.tsx                          # load water, add under getStreamingRoot()
```

## Iterations (each keeps `npm test` + the app green)

1. ✅ **Water parser — DONE.** `renderware/parsers/text/water.parser.ts` `parseWater(text): WaterQuad[]`
   (`WaterQuad { vertices: [x,y,z][] }`) — skips `processed`/blank lines; per line `vertexCount = (tokens−1)/7`,
   reads each vertex's first 3 numbers (ignores the 4 normal/flow params + type flag). Barrel-exported. 3 tests
   (4-vert quad, 3-vert tri, header/blank skipped). Verified on real `water.dat`: **307 polys (301 quads + 6
   tris)**, Z from −5/0 (sea) to lake heights + one interior pool at 1082.7. 199 tests + tsc + eslint + build
   clean.

2. ✅ **Water mesh builder — DONE.** `renderware/three/build-water.ts` `buildWater(quads, texture): THREE.Mesh`
   — one merged `BufferGeometry` (quad → 2 tris via grid-ordered corners, tri → 1), **tiled world-X/Y UVs**
   (`TILE 16`), one `MeshBasicMaterial` (`map`, `transparent` opacity 0.7, `DoubleSide`, `depthWrite:false`);
   texture `wrapS/wrapT = RepeatWrapping`. Native Z-up. Barrel-exported. 2 tests (merged quad+tri index/vertex
   counts; material/texture wrapping). 201 tests + tsc + eslint + build clean.

3. ✅ **Adapter + wire-in — DONE (code; browser pending).** `WorldAdapter.loadWater(waterUrl, txdUrl)` +
   `GtaSaWorldAdapter` impl (`fetchText` water.dat + `fetchBuffer` particle.txd → `parseWater` +
   `buildTextureMap(parseTxd)`.get('waterclear256') → `buildWater`). Bootstrap loads it after streaming/collision
   and adds it under `game.getStreamingRoot()` (−90°X). Verified `get('waterclear256')` resolves (keys are
   lowercased). 201 tests + tsc + eslint + build clean. **Browser acceptance pending** — note: spawn (Ganton)
   is **inland/above sea level**, so the sea (z=0) is below the terrain there; travel to the coast/beach or a
   lake to see the surface.

## Decisions / open questions

- **No shader now** (explicit): `MeshBasicMaterial` + texture; opacity/tint tuned in-browser. Animated UV
  scroll, reflections, depth fog, and shoreline are the later "water shader" task.
- **Texture:** `waterclear256` (the clear surface). `waterwake` is foam — unused now.
- **Tiling scale `TILE`:** world units per texture repeat (e.g. ~16) — tune in-browser.
- **Parent:** reuse `streamingRoot` (−90°X, persistent) — no new Game API; the streaming system won't remove
  it. (A dedicated `waterRoot` is an option if it ever needs separate toggling.)
- **One merged mesh** (not per-quad / not streamed): the whole-map water is tiny; stream/cull later only if
  needed.

## Out of scope (later)

The water **shader** (animated waves/UV scroll, reflection/refraction, depth-based colour, shoreline foam),
swimming/buoyancy physics, underwater fog/tint, per-zone water flow from the `water.dat` flow params, and
culling/streaming the water.
