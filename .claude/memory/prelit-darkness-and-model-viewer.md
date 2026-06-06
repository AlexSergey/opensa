---
name: prelit-darkness-and-model-viewer
description: Prelit vertex-colour darkness is data, not a parser bug; standalone DFF viewer at /viewer.html
metadata:
  type: project
---

**Finding (2026-06):** some map models look "darker" (user flagged `wattspark1_LAe2` / txd `lae2tempshit`, and `lae2_ground08` / txd `burnsground`). This is **not a DFF-parser bug** — `parseDff` reads their prelit vertex colours correctly (well-formed: alpha=255, smooth 0..255 range). The models simply have **genuinely dark baked prelit**: avg RGB ≈ **40** for `lae2_ground08` and ≈ **100** for `wattspark1_LAe2`, vs ≈ **149** for a normal neighbour (`lae2_ground01`). All are `flags=0x2f` (LIGHT|POSITIONS|PRELIT|TEXTURED|TRISTRIP), **no stored normals**.

The darkness is a **render/material question, not parsing**: `build-clump.ts` applies prelit as a `color` vertex attribute with `vertexColors: true` on a **`MeshStandardMaterial`** — so the final pixel is `texture × prelitColour × sceneLight` (ambient 1.5 + directional 1.5). Prelit already bakes the lighting, so multiplying by lit shading darkens it further. Open question to resolve: GTA/RenderWare typically uses **MODULATE2X** for prelit (128 = neutral 1.0, 255 = 2.0×) and bakes lighting into the vertex colours (closer to an **unlit** look). Candidate fixes (not yet decided): render map geometry unlit (MeshBasic, texture×prelit) or apply a ×2 prelit modulate, and/or revisit colour-space. See [[binary-ipl-render-approach]] (prelit applied in `buildClump`/`buildClumpParts`).

**Standalone DFF viewer (dev tool):** `viewer.html` + `src/standalone/model-viewer.ts` — open `/viewer.html` (run `npm run dev` + `npm run serve:static`). It reuses the **real** asset path (`TXDLoader`→`parseTxd`→build-texture, `DFFLoader`→`parseDff`→`build-clump`) but is **isolated from map/streaming/instancing**, so it pins issues to parser+build vs the map pipeline. Toggles: **Lit (MeshStandard) vs unlit (MeshBasic)**, **Prelit vertex colours on/off**, **Prelit ×2 (MODULATE2X)**. Test assets were extracted from `static/models/gta3.img` into `static/viewer/` (4 files). Added as a second Vite entry (`vite.config.ts` `rollupOptions.input.viewer`). Reusable for inspecting any model — extend `MODELS` + extract its dff/txd.
