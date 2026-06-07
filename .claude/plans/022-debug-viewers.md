# 022 — Debug viewers (object / vehicle / character)

## Goal

Standalone, browser-based dev tools to inspect assets in isolation from the game, streaming and
instancing layers. Each reuses the **real** build path (same parsers/builders as the game), so what
they show is exactly what the game produces — they pin a problem to the asset/build vs. the runtime.

Each viewer is a separate Vite HTML entry (`rollupOptions.input` in `vite.config.ts`) + a root
`*.html` that loads `src/standalone/<name>.ts`. Run `npm run dev` + `npm run serve:static`, open the
URL. All three put native GTA Z-up content under a `content` group rotated `-90°X` (mirroring the
game's entity/streaming root) so models stand up; the camera auto-frames after load (OrbitControls).

## Viewers

### `/object-viewer.html` — map models (`object-viewer.ts`)

Renamed from the former `model-viewer` / `viewer.html`. Loads a model from `static/viewer/` via the
real `TXDLoader`/`DFFLoader` path. Toggles: **Lit** (MeshStandard vs MeshBasic), **Prelit vertex
colours**, **Prelit ×2 (MODULATE2X)**, and **Collision**.

Collision source: map objects keep their COL in `gta3.img` (795 MB), **not embedded in the DFF**, so
the viewer can't parse it from the model the way the vehicle viewer can. Instead it is **pre-baked**:
`scripts/extract-viewer-collision.ts` reads `gta3.img` locally, builds the collision index and writes
each listed model's COL to `static/viewer/<model>.col.json` (vertices as a plain array). The viewer
fetches that JSON, rebuilds a `ColModel` (`vertices` → `Float32Array`) and renders
`buildCollisionWireframe`, wrapped in a `-90°X` group to match `DFFLoader`'s `convertToYUp`. Re-run
the script after adding a model to `MODELS`.

### `/vehicle-viewer.html` — vehicles (`vehicle-viewer.ts`)

Loads `static/vehicles/<name>.dff|.txd` (admiral / admiral2 / camper) via `buildVehicle` (debug paint
+ neutral wheel scale; generic wheel/light textures from `gta3.img` are **not** loaded → those bits
render untextured, the body uses the car's own TXD). UI:

- **Model select** + **part select** — parts come from `BuiltVehicle.parts`; the selected one is
  highlighted with a `Box3Helper`.
- **Open / close door** (button or `E`) — matches the selected part to `BuiltVehicle.doors` by side
  and swings the hinge.
- **Damage / repair** — swaps the selected part's `_ok`/`_dam` meshes.
- **Collision** — the embedded vehicle COL (`parseDffCollision` → `buildCollisionWireframe`).
- **LOD (chassis_vlo)** — shows `BuiltVehicle.lod`, hides the HD body (same swap the game's LOD system
  does).

Robustness: camera framing **and** the selection box are derived from the **COL bounds** (authored
clean), not the mesh bbox. Modded DFFs (e.g. `admiral.dff`, 4.8 MB, embedded COL `slamvan_col`) have
stray vertices that blow up the mesh bbox — without this admiral framed off-screen ("didn't show") and
the highlight ballooned. The selection box is `setFromObject(part).intersect(colBox)`. Same robustness
the game adapter uses to size half-extents from COL.

### `/character-viewer.html` — skinned peds (`character-viewer.ts`)

Loads `static/player/tommy.dff|.txd` via `buildSkinnedClump` + `orientCharacter`, and `ped.ifp` from
`static/anim/animations.img` (`parseIfp` → `buildAnimationClip` → `AnimationController`). UI: animation
`<select>` (change it or click the scene to replay), **Loop**, **Skeleton** (`SkeletonHelper`),
**Collision** (capsule box from the game's `[0.3, 0.3, 0.9]` half-extents). Imports `game/character/*`
— allowed: a standalone viewer is a UI-layer consumer, not `game/**`.

## Files

- New: `src/standalone/vehicle-viewer.ts` + `vehicle-viewer.html`,
  `src/standalone/character-viewer.ts` + `character-viewer.html`,
  `scripts/extract-viewer-collision.ts`, `static/viewer/*.col.json` (generated).
- Renamed: `src/standalone/model-viewer.ts` → `object-viewer.ts`, `viewer.html` → `object-viewer.html`
  (+ `vite.config.ts` input key `viewer` → `objectViewer`).
- Changed: `vite.config.ts` (4 inputs), `eslint.config.ts` (scripts override now also matches
  `scripts/**/*.ts` so TS dev scripts may use `console`), `README.md`, `roadmap.md`.

## Out of scope

Loading the full `gta3.img` in a viewer (too large); generic vehicle textures in the vehicle viewer;
multiple peds / non-tommy characters; animation scrubbing/blend UI; saving viewer state.
