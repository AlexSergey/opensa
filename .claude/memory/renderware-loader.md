---
name: renderware-loader
description: GTA SA RenderWare DFF/TXD loader architecture in this project
metadata: 
  node_type: memory
  type: project
  originSessionId: 9c42fe2a-bd64-4999-af30-043b1ca3dd5c
---

This project (gta-sa) loads real GTA San Andreas RenderWare assets into a React + react-three-fiber WebGL scene. Test assets live in `static/` (`bsor_cedar1_hi.dff`, `bsor.txd` ~49MB), served via `npm run serve:static` (serve on :3001, CORS) with `VITE_STATIC_URL` in `.env`.

Loader lives in `src/renderware/`, deliberately layered:
- `parser/*` — renderer-agnostic binary parsing (no three.js imports): `binary-stream.ts` (LE DataView cursor), `chunks.ts` (RW 12-byte chunk header `[type:u32][size:u32][version:u32]` + `findChild`/`forEachChild` walkers), `constants.ts`, `types.ts` (RWClump/RWGeometry/RWTextureDictionary data model), `dff.ts` (`parseDff`), `txd.ts` (`parseTxd`).
- `three/*` — adapter: `build-clump.ts` (RWClump→Group, groups triangles by material, computes normals when absent, rotates Z-up→Y-up), `build-texture.ts` (DXT1/3/5→CompressedTexture, 8888/palette→DataTexture), `DFFLoader.ts`/`TXDLoader.ts` (THREE.Loader subclasses for `useLoader`; `DFFLoader.setTextures(map)` injected via useLoader's extensions callback).

DFF triangles are packed `[v2,v1,matIdx,v3]`; geometry often has no stored normals + prelit vertex colors (baked SA lighting → renders dark). TXD textures keyed by lowercased name. Plan: `.claude/plans/001-renderware-dff-loader.md`.

**TXD pixel formats (`txd.ts` `classifyFormat`):** DXT1/3/5 by d3dFormat FourCC; palettized PAL8/PAL4 expanded via colour table; **uncompressed 32-bit classified by `depth === 32`** (covers both A8R8G8B8 / rasterFormat C8888 `0x500` AND X8R8G8B8 / rasterFormat C888 `0x600`). Earlier bug: only C8888 was accepted, so C888/X8R8G8B8 textures were silently dropped → those materials rendered white (e.g. palm trunk `kbtree3_test` in `gta_tree_palm.txd`). 16-bit (565/1555/4444) still unsupported (skipped).

Tests: vitest (config `vitest.config.ts`, node env; `npm test` / `test:watch` / `test:coverage`). Specs co-located `src/renderware/**/*.test.ts` (52 tests, ~97% stmt / 100% func). Synthetic RW byte buffers built via helpers in `src/renderware/test-utils.ts` (`chunk()`, `u32`, `f32a`, `fixedString`, `toArrayBuffer`…). Parser/loader specs also assert against the real `static/` assets, guarded by `it.skipIf(!existsSync(...))`. Loader specs stub `FileLoader.prototype.load` with `vi.spyOn` to avoid I/O.

Explicit extension points (not yet done): skinning (SkinPLG), multi-atomic clumps, frame parenting, tristrip via BinMeshPLG, 16-bit/PAL rasters fully, COL/IMG/IDE/IPL world streaming. See [[project-overview]].
