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

Explicit extension points (not yet done): skinning (SkinPLG), multi-atomic clumps, frame parenting, tristrip via BinMeshPLG, 16-bit/PAL rasters fully, COL/IMG/IDE/IPL world streaming. See [[project-overview]].
