---
name: standalone-viewers
description: Three standalone dev viewers (object/vehicle/character) under src/standalone, separate Vite HTML entries
metadata:
  type: reference
---

Isolated dev tools in `src/standalone/*` (no game/streaming), each its own Vite entry in
`vite.config.ts` `rollupOptions.input` + a root `*.html`. Run `npm run dev` + `npm run serve:static`.
Detailed plan: `.claude/plans/022-debug-viewers.md`; brief usage in `README.md`.

- **`/viewer.html`** (`object-viewer.ts`) — map models; prelit/MODULATE2X/lit toggles + a
  **Collision** toggle. Assets in `static/viewer/`. (Was `model-viewer`/`viewer.html` — renamed.)
  Map objects keep COL in `gta3.img` (795 MB, NOT embedded in the DFF), so collision is pre-baked by
  `scripts/extract-viewer-collision.ts` (`npx tsx …`) into `static/viewer/<model>.col.json`; the viewer
  fetches that, rebuilds the `ColModel`, and renders `buildCollisionWireframe` wrapped `-90°X` (to match
  `DFFLoader` convertToYUp). Re-run the script after adding a model to `MODELS`. See [[prelit-darkness-and-model-viewer]].
- **`/viewer.html?tab=vehicle`** (`vehicle-viewer.ts`) — reuses `buildVehicle` + `buildCollisionWireframe`.
  Picks `static/vehicles/<name>.dff|.txd` (admiral/admiral2/camper). UI: part `<select>` (from
  `BuiltVehicle.parts`, highlighted with a `BoxHelper`), open/close door (button or `E`, matches the
  selected part to `BuiltVehicle.doors` by side), damage/repair (swaps the part's `_ok`/`_dam`),
  Collision wireframe toggle, LOD toggle (shows `BuiltVehicle.lod` = `chassis_vlo`, hides HD).
  Camera framing AND the selection `Box3Helper` are clamped to the **COL bounds** (authored clean),
  NOT the mesh bbox: modded DFFs like `admiral.dff` (4.8 MB) have stray vertices that blow up the mesh
  bbox (admiral "didn't show"; the highlight ballooned). Same robustness the game adapter uses for
  half-extents.
- **`/viewer.html?tab=character`** (`character-viewer.ts`) — reuses `buildSkinnedClump` + `orientCharacter`
  - `AnimationController`; loads `ped.ifp` from `static/anim/animations.img`. UI: animation `<select>`
    (click scene or change select to replay), Loop, Skeleton (`SkeletonHelper`), Collision (capsule box
    from the game's `[0.3,0.3,0.9]` half-extents). Imports `game/character/*` (allowed — standalone is a
    UI-layer consumer, not `game/**`).

All three put native GTA Z-up content under a `content` group rotated `-90°X` (mirrors the game's
entity/streaming root) so models stand up. Generic vehicle textures (wheels/lights from gta3.img) are
NOT loaded in the vehicle viewer — those bits render untextured; the body uses the car's own TXD.
