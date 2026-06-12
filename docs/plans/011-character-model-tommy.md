# 011 — Character model (Tommy Vercetti): bind-pose render + skeleton

## Goal

Replace the temporary 3ds cube player with a real GTA-SA character DFF/TXD — **Tommy Vercetti**
(`static/player/tommy.dff` + `tommy.txd`, an SA-adapted model). Tommy must:

1. **Spawn instead of the cube**, textured, standing upright on CJ's parking lot at `PLAYER_SPAWN`.
2. **Interact with collision** exactly like the cube does today (dynamic body + streamed map colliders) —
   he lands on the ground, walks, and the camera follows.
3. Carry his **skeleton** (the 33-bone hierarchy) as a real `THREE.Skeleton` / `SkinnedMesh`, rendered in
   **bind pose** — **no animation playback in this task**. This is the foundation the next task (the
   *animation manager*) will drive.

Single-mesh model only — we are NOT doing CJ's multi-component (head/body/etc.) system now.

## Model verification (done)

`tommy.dff` parses with our existing `parseDff`:
- `atomics=1`, `frames=33` (named skeleton: `Root → Pelvis → Spine → Spine1 → Neck → Head`, `L/R UpperArm/
  ForeArm/Hand/Finger`, `L/R Thigh/Calf/Foot/Toe0`, jaw/brows/breast/belly), `geometries=1`.
- geo: 1153 verts, 1355 tris, flags `0x36` (LIGHT|NORMALS|POSITIONS|TEXTURED), **normals present**, 1 UV
  layer, 1 material → texture `player`. bbox ≈ `[-0.9,-0.95,-0.18]..[0.85,0.88,0.17]` → a **T-pose** lying in
  a plane (two axes ≈ 1.8 = height & arm-span, the third ≈ 0.35 = depth). `tommy.txd`: 1 texture `player`
  256×256.
- It is a **skinned** model: the SkinPLG (bone indices/weights/inverse-bind matrices) is a geometry
  extension our parser currently **skips**. For a static bind-pose render that is fine (vertices are already in
  bind pose); for the skeleton/animation it must be parsed.

## Architecture notes

- **Layer boundary:** `no-restricted-imports` forbids `src/game/**` (except `game/adapters/**`) from importing
  `renderware`. So the DFF/TXD load + skinned-mesh build live in **`renderware` + `game/adapters`** (or the
  `ui` bootstrap, which may import renderware — the standalone viewer already does). Recommended: a new
  `WorldAdapter.loadCharacter(...)` on `GtaSaWorldAdapter`, so `game`/`ui` stay model-agnostic.
- **Collision stays a box.** The player is a Rapier dynamic body (`createCharacterBody`, plan 008); collision
  interaction is unchanged. Today `setupCharacter` sizes the box from the mesh bbox — for a T-pose that would
  be ~1.8 wide. We must size the box to a **human** (~`[0.3, 0.3, 0.9]` half-extents), decoupled from the
  visual mesh, and offset the mesh so the feet sit at the box base.
- **Orientation/scale:** SA peds are authored in a bind orientation that is NOT world-Z-up (our bbox shows the
  height axis is X or Y, depth on Z). The mesh goes under `Game.entityRoot` (which already applies the −90°X
  Z-up→Y-up display). Determine the rotation that stands Tommy upright + a uniform scale (SA units ≈ metres, so
  near 1:1) + a foot offset — **tune in browser**, then record the final transform constants.
- **Reuse:** `DFFLoader`/`TXDLoader` → `parseDff`/`parseTxd` → `buildClump`/`build-texture` (the standalone
  viewer path, plan: `prelit-darkness-and-model-viewer`). `setupCharacter` (plan 008) wires physics + render
  sync; we only change the mesh it is handed + the box sizing.

## Module touch list

```
src/renderware/parsers/binary/
  constants.ts            # + rwID_SKIN (0x0116) plugin id
  types.ts                # + RWGeometry.skin? { numBones, boneIndices, boneWeights, inverseBindMatrices }
  dff.ts                  # parse the Skin plugin (geometry extension); non-skinned models unchanged
src/renderware/three/
  build-clump.ts          # extract shared material/texture helper for reuse
  build-skinned-clump.ts  # NEW: frames -> THREE.Bone tree + Skeleton; geometry -> SkinnedMesh (bind pose)
  dff-loader.ts           # build skinned when the clump has skin data (or a setSkinned flag)
src/game/interfaces/world-adapter.interface.ts  # + loadCharacter(dff, txd): Promise<CharacterModel>
src/game/adapters/gta-sa-world.adapter.ts        # implement loadCharacter (TXD+DFF -> skinned group + skeleton)
src/game/character/setup-character.ts            # explicit human box half-extents + foot offset; expose skeleton
src/game/character/load-player.ts                # retire the 3ds cube (or keep behind a flag)
src/ui/canvas-host.tsx                           # load Tommy instead of the cube; final transform constants
```

## Iterations (each keeps `npm test` + the app green)

1. ✅ **Static bind-pose Tommy replaces the cube — DONE (code; browser acceptance pending user).**
   - `GtaSaWorldAdapter.loadCharacter(dffUrl, txdUrl): Promise<Object3D>` — `TXDLoader` + `DFFLoader`
     (`setTextures`, `setConvertToYUp(false)` → native model space) → the `buildClump` Group. Added to the
     `WorldAdapter` interface.
   - `game/character/orient-character.ts` `orientCharacter(model, placement, boxHalfZ)`: wraps the model in a
     `Group` (the render-sync target) so the per-frame Transform doesn't clobber the stand-up correction; the
     inner model gets the rotation/scale and is shifted to centre horizontally + drop feet (min Z) to the box
     base. 2 unit tests.
   - `setupCharacter(game, player, spawn, halfExtents?)`: uses the explicit human box when given, else the old
     mesh-bbox sizing (`meshHalfExtents` helper).
   - Bootstrap: `adapter.loadCharacter(tommy.dff/.txd)` → `orientCharacter(…, TOMMY_PLACEMENT, PLAYER_HALF_EXTENTS[2])`
     → `setupCharacter(…, PLAYER_HALF_EXTENTS)`. `PLAYER_HALF_EXTENTS=[0.3,0.3,0.9]`, `TOMMY_PLACEMENT={rotation:[π/2,0,0],scale:1}`
     (model up=+Y → GTA +Z; bone audit: foot→head = +Y len 1.56, arm span = +X). Cube no longer loaded.
   - 180 tests green; tsc + eslint + build clean. **Browser acceptance ✅ confirmed — Tommy stands upright on
     the ground at spawn** (`TOMMY_PLACEMENT={rotation:[π/2,0,0],scale:1}` correct as-is).

2. ✅ **Parse the Skin plugin in the DFF parser — DONE.**
   - Recon confirmed tommy's SkinPLG (`0x116`, inside the Geometry's Extension alongside BinMeshPLG): header
     `u8 numBones(32), numUsedBones(21), maxWeights(4), pad`, then `usedBones[21]`, then per-vertex `4×u8`
     bone indices (numVertices×4), per-vertex `4×f32` weights, then `numBones×16 f32` inverse-bind matrices,
     then a **12-byte split trailer** (boneLimit/numMeshes/numRLE — skipped).
   - **Inverse-bind matrix RW layout = `right.xyz,0, up.xyz,0, at.xyz,0, pos.xyz,0`** (16 floats; 4th column
     padding). For iter 3 → `THREE.Matrix4` columns = (right, up, at, pos) (same transpose as `frameMatrix`).
   - `constants.ts` `RwSection.SKIN=0x116`; `types.ts` `RWSkin` + `RWGeometry.skin?`; `dff.ts`
     `parseSkinExtension` (walks Geometry Extension → Skin). Non-skinned geometries → `skin = undefined`
     (map models unchanged). Verified on tommy: numBones 32, all 1153 vertices' weights sum to 1, max bone
     index 30 < 32. 182 tests green (+ synthetic skinned-geometry test + non-skinned-undefined); build clean.
   - **Note for iter 3:** 33 frames vs 32 skin bones — frame 0 is the root null (`""`); skin bone i likely
     maps to frame i+1, but verify via the bind pose (must stay undistorted) / HAnim if needed.

3. ✅ **Build a `THREE.SkinnedMesh` + `Skeleton` (bind pose) — DONE (code; browser acceptance pending).**
   - `renderware/three/build-skinned-clump.ts` `buildSkinnedClump(clump, textures) → { root, skeleton,
     bonesByName } | null`: one `Bone` per frame (local transform from the RW frame, parented per
     `parentIndex`); `SkinnedMesh` with `skinIndex`/`skinWeight` attributes + the shared `buildMaterial`
     (exported from `build-clump`, with `groupTrianglesByMaterial`). Skeleton bones ordered to skin indices
     (**skin bone i ↔ frame i+1**, frame 0 = dummy root). Uses `new Skeleton(bones)` (auto inverses from the
     bones' own bind world matrices) → **bind pose is exactly the raw mesh regardless of the mapping**; the
     mapping only matters for animation. Returns null if not skinned. 3 unit tests.
   - `WorldAdapter.loadCharacter` now returns `CharacterModel { object, skeleton, bonesByName }` — the adapter
     fetches DFF+TXD buffers, `parseDff`/`parseTxd`/`buildTextureMap`, then `buildSkinnedClump` (fallback
     `buildClump`, `skeleton: null`). `setupCharacter(…, { halfExtents, skeleton, bonesByName })` exposes
     `skeleton` + `bonesByName` on `CharacterContext` for the animation manager. Bootstrap threads them through.
   - 185 tests green; tsc + eslint + build clean. **Browser acceptance pending:** Tommy looks identical to
     iter 1 (correct bind pose) but is now a real skinned `Skeleton` (~32 bones); still no animation.

4. ✅ **Cleanup + animation foundation — DONE.**
   - Removed the cube placeholder: deleted `game/character/load-player.ts` + `static/player/player.3ds`
     (no remaining references). Updated `setupCharacter` doc + the `player-cube-placeholder` memory (now
     historical → Tommy). `CharacterContext` exposes `skeleton` + `bonesByName` (from iter 3).
   - Final green: 185 tests + tsc + eslint + build all clean; knip shows only the pre-existing barrel-type
     noise. Final placement constants live in the bootstrap: `PLAYER_HALF_EXTENTS=[0.3,0.3,0.9]`,
     `TOMMY_PLACEMENT={rotation:[π/2,0,0],scale:1}`.

**Plan 011 COMPLETE (iters 1–4).** Tommy renders as a textured skinned mesh + real `Skeleton` (bind pose),
spawns on the parking lot, lands/walks with the streamed collision, camera follows. No animation yet — the
**animation manager** (clip playback driving `CharacterContext.skeleton` / `bonesByName`) is the next task.

## Decisions / open questions

- **Load via adapter vs ui:** recommend `WorldAdapter.loadCharacter` (keeps the renderware seam, testable);
  the bootstrap already builds the adapter.
- **Loose files vs WIMG archive:** Tommy is loose in `static/player/` → load by URL via `TXDLoader`/`DFFLoader`
  (like the viewer), not the packed `gta3.img`.
- **Skin now or defer:** the user asked for "character WITH his skeleton" now (animation later) → build the
  real `Skeleton`/`SkinnedMesh` in this task (iters 2–3), so the animation manager only adds clip playback.
  Iteration 1 ships a visible Tommy first (static), so we always have a working build.
- **Physics shape:** keep the box (a capsule is a later nicety); collision behaviour identical to the cube.
- **Bind-pose orientation/scale/offset:** unknown until browser tuning; capture as named constants in the
  bootstrap once dialed in.

## Out of scope (next tasks)

- **Animation manager** (clip playback driving the skeleton) — the explicit next task.
- CJ-style multi-component characters (separate head/body/hands), facial/IK, ragdoll, capsule collider,
  character LOD, and loading peds from the game archive by id.
