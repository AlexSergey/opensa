# 012 — Animation manager (walk / run / jump / idle)

## Goal

Drive Tommy's skeleton (plan 011) with real GTA SA animations from `static/anim/ped.ifp` — an
**animation manager** that plays **idle, walk, run, jump** and blends between them based on the
character's movement state. No new gameplay; the player already moves via physics — we add the
matching visual motion on the skeleton.

## What we have (verified)

- `static/anim/ped.ifp` — **ANP3** format, 294 animations, parses cleanly end-to-end. Contains the
  locomotion set: `WALK_civi`, `run_civi`, `sprint_civi`, `IDLE_stance`, `JUMP_launch`, `JUMP_glide`,
  `JUMP_land` (+ many variants).
- **Bone names match the skeleton exactly:** `WALK_civi` has 32 bone tracks, **32/32 match** Tommy's
  frame/bone names (trimmed: `Root, Pelvis, Spine, … R Toe0`). So tracks map to bones **by name**.
- Frame types: the **root bone is type 4** (rotation + translation), every other bone type 3
  (rotation only). `WALK_civi` ≈ 35 keyframes/bone.
- `CharacterContext` already exposes `skeleton` + `bonesByName` (plan 011). `System.update(delta)`
  exists for `AnimationMixer.update(delta)`. The controller's movement state is derivable from physics
  (`getLinvel(handle)` planar speed, `isGrounded(handle, halfHeight)`).
- `static/data/animgrp.dat` — ped gait groups (`man = walk_civi/run_civi/sprint_panic/idle_stance/…`);
  useful later for per-ped gaits, **not required** for the first manager (we hardcode the `man` group).
- `static/anim/anim.img/` — an extracted folder of **133 activity IFPs** (bar, baseball, …). **Not
  needed** for walk/run/jump (those live in `ped.ifp`). A packer to bundle it into a WIMG archive is a
  **separate, secondary** deliverable (below).

**Conclusion: everything required for walk/run/jump/idle is present.** `ped.ifp` is loaded loose by URL.

## ANP3 layout (decoded)

```
char[4] "ANP3"; u32 size(=fileSize-8)
char[24] internalName ("ped"); i32 numAnims
per animation:
  char[24] name; i32 numBones; i32 unknown; i32 unknown2
  per bone:
    char[24] name; i32 frameType; i32 frameCount; i32 boneId
    per frame:
      i16 rot.x, rot.y, rot.z, rot.w   (quaternion, /4096)
      i16 time
      if frameType == 4: i16 pos.x, pos.y, pos.z   (translation, /1024)
```

(Names carry a trailing 3ds-max export path after the NUL — read up to the first NUL. Quaternion sign
convention + time scaling are confirmed-in-browser items — see open questions.)

## Architecture / module touch list

```
src/renderware/parsers/binary/
  ifp.ts                 # parseIfp(buffer) -> IfpAnimation[] (ANP3; renderer-agnostic, no three)
  ifp.test.ts            # synthetic ANP3 round-trip
src/renderware/three/
  build-anim-clip.ts     # IfpAnimation -> THREE.AnimationClip (bone-name tracks; root-motion strip)
src/game/interfaces/world-adapter.interface.ts  # + loadAnimations(ifpUrl): Promise<Map<string, AnimationClip>>
src/game/adapters/gta-sa-world.adapter.ts        # implement (fetch + parseIfp + build-anim-clip)
src/game/character/
  animation-controller.ts        # AnimationMixer wrapper: play(state, fade), update(delta)
  character-animation.system.ts  # System: movement state -> animation state -> crossfade; mixer.update
src/ui/canvas-host.tsx           # load ped.ifp via adapter, build controller, register the system
scripts/pack-anim-img.mjs        # (secondary) pack static/anim/anim.img/ -> WIMG archive
```

## Iterations (each keeps `npm test` + the app green)

1. ✅ **IFP (ANP3) parser — DONE.** `renderware/parsers/binary/ifp.ts` `parseIfp(buffer): IfpAnimation[]` —
   `IfpAnimation { name; bones: IfpBone[] }`, `IfpBone { name; boneId; frames: IfpKeyframe[] }`,
   `IfpKeyframe { rotation:[x,y,z,w]; translation?:[x,y,z]; time:number }` (renderer-agnostic; `rotation`
   = i16/4096 in file order, `translation` = i16/1024 for type-4 bones, `time` = raw i16). Exported from the
   barrel. 4 synthetic-ANP3 tests (types 3 & 4; non-ANP3 throws). Verified on real `ped.ifp`: 294 anims,
   `WALK_civi` 32 bones, **all 916 quats norm ≈ 1** (so order/scale correct), root has translation, times
   monotonic `0,2,…,68`. 189 tests green. **Time note for iter 2/3:** raw times span 0..68 (step 2, 35
   frames) → `/60` ≈ 1.13 s is the likely seconds scale (tune in the clip builder).

2. ✅ **AnimationClip builder — DONE.** `renderware/three/build-anim-clip.ts`
   `buildAnimationClip(anim, options?): THREE.AnimationClip` — per bone a `QuaternionKeyframeTrack`
   `"<trimmed bone>.quaternion"`; times scaled to seconds (`timeScale` default `1/60`). **Translation is
   stripped by default** (`includeTranslation` opt-in → `VectorKeyframeTrack` `"<bone>.position"`): WALK/run
   bake the forward locomotion into the **root's +Y translation** (WALK 0→1.72, run 0→3.16, accumulating;
   X/Z flat), and physics owns position, so rotation-only = in-place. Quaternion taken file-order (x,y,z,w);
   the convention flip (if mirrored) lives here. Barrel-exported; 2 tests. Verified on real `WALK_civi`: 32
   quaternion tracks, duration **1.133 s** (68/60 — believable cycle), track names match the skeleton
   (`Root/Pelvis/Spine/Spine1…`). 191 tests green.
   - **Bone-name retargeting deferred to iter 3** (needs the skeleton): WALK/run are 32/32 by trim alone, but
     sprint/idle/jump name the root **`Normal`** (not `Root`), and `JUMP_launch` has **`Spine 1`/`Spine 2`**
     (space) vs the skeleton's `Spine1`/`Spine2`. Iter 3 retargets via `bonesByName` with a normalized key
     (`trim().toLowerCase().replace(/\s+/g,'')` + alias `normal→root`).

3. ✅ **Adapter seam + AnimationController — DONE (code; browser checkpoint pending).** `WorldAdapter.
   loadAnimations(ifpUrl): Promise<Map<string, AnimationClip>>` (adapter: `fetchBuffer` → `parseIfp` →
   `buildAnimationClip` per anim, keyed by lower name). `game/character/animation-controller.ts`
   `AnimationController(root, clips, bonesByName)`: `AnimationMixer` on the player wrapper; on construction
   **retargets** every clip's tracks onto the skeleton via exported `retargetClip` (normalized key
   `trim().toLowerCase().replace(/\s+/g,'')` + alias `normal→root`, drops unmatched, clones — doesn't mutate
   source). `play(name, fade=0.2)` crossfades looping clips; `update(delta)` ticks the mixer.
   `character-animation.system.ts` `CharacterAnimationSystem` ticks the controller. Bootstrap loads
   `ped.ifp`, builds the controller on `player` + `character.bonesByName`, **forces `walk_civi`**, registers
   the system. 2 `retargetClip` tests; 193 tests green; build clean. **Browser checkpoint pending:** Tommy
   should walk in place, upright — if mirrored/twisted, flip the quaternion convention in `build-anim-clip`;
   if too fast/slow, adjust `timeScale`.

4. ✅ **Locomotion state machine + facing — DONE (code; browser acceptance pending).**
   `character-animation.system.ts` `CharacterAnimationSystem(controller, physics, body, halfHeight, character,
   config)`: each `update` (frozen unless `gameState==='play'`) reads `getLinvel` planar speed + `isGrounded`
   → `clipFor`: not grounded → `jump_glide`; speed `<1` → `idle_stance`; `<18` → `walk_civi`; else `run_civi`
   → `controller.play(...)` (crossfade 0.2 s); then **turns the body to face movement** (`character.rotation.z
   = atan2(-vx, vy)` above 0.5 speed; runs after render-sync so it sticks); `controller.update(delta)`.
   To get walk vs run from one input, the controller gained two speeds + a **run key**:
   `WALK_SPEED=10`/`RUN_SPEED=26`, `ControlsConfig.run?` (`ShiftLeft`); default walk, hold Shift to run.
   `CharacterContext` exposes `bodyHandle` + `halfExtents`. Bootstrap plays `idle_stance` initially + registers
   the system; foot offset `0.04`. 193 tests green; build clean. **Browser acceptance ✅ — camera behind,
   walks facing forward, turns correctly, idle/walk/run/jump switch.** Facing: store `facing` (default `π` so
   idle faces away from the camera's −Z start side) and **apply every frame** (render-sync overwrites the
   wrapper rotation otherwise); update it to `atan2(-vx, vy)` while moving. (Camera is a free-orbit follow at
   azimuth π, independent of the body.)

5. ✅ **Jump sequence + polish — DONE (code; browser acceptance pending).** `AnimationController.play` gained a
   `loop` flag (`LoopOnce` + `clampWhenFinished` for one-shots) + `duration(name)`. `CharacterAnimationSystem`
   runs a jump state machine `ground → launch → glide → land → ground`: `ground` (not grounded) → `launch`
   (`JUMP_launch`, 0.2 s, once); `launch` → `glide` (`JUMP_glide`, 0.5 s, loop) after its duration **or** `vz <
   0`; `glide`/`launch` (grounded) → `land` (`JUMP_land`, 0.233 s, once); `land` → `ground` after its duration.
   `FADE 0.12`. 193 tests green; build clean. **Browser acceptance pending:** jump shows launch→glide→land,
   not a single glide loop; locomotion otherwise unchanged. (`sprint_civi` + `animgrp.dat` gaits remain
   optional later niceties.)

6. ✅ **`anim.img` packer + load anims from the archive — DONE.** `scripts/pack-anim-img.mjs` (`npm run
   pack:anim`) bundles **the 133 `static/anim/anim.img/` IFPs + the loose `ped.ifp`** (locomotion isn't in
   the folder) into a WIMG archive (`WIMG0001` header + JSON dir + concatenated data, like `pack-img.mjs`).
   Output **`static/anim/animations.img`** (the source folder is named `anim.img`, so the file can't share
   that name; env-overridable `ANIM_SRC`/`ANIM_PED`/`ANIM_OUT`). Ran it → 134 IFPs, 11.8 MB. `WorldAdapter.
   loadAnimations(archiveUrl, ifpName)` now `loadArchive` (cached) + `archive.get(ifpName)` + `parseIfp`;
   bootstrap loads `…/anim/animations.img` `'ped.ifp'`. Other IFPs load free from the cached archive later.
   193 tests + tsc + eslint + build clean.

**Plan 012 COMPLETE (iters 1–6).** Tommy plays idle/walk/run/jump from the packed animation archive, faces
his movement, camera behind; speeds/jump live in `Config.movement`.

## Decisions / open questions

- **Load via adapter** (`loadAnimations`) — keeps the renderware/IFP code out of `game` (the layer rule),
  testable; the bootstrap already builds the adapter. `ped.ifp` is fetched loose by URL (not archived).
- **Movement state source** — the animation system reads physics (`getLinvel` planar speed + `isGrounded`)
  directly using the player body handle + half-height; **no controller changes needed**.
- **Root motion** — strip root X/Y translation (in-place; physics owns position). Foot-sliding is accepted
  for the first pass; foot-locking / true root motion is later.
- **Quaternion convention + time scale** — IFP rot is `i16/4096`, time is `i16`; the exact sign flip
  (conjugate?) and seconds scaling are confirmed in the iteration-3 browser checkpoint and isolated in
  `build-anim-clip` so they're a one-line change.
- **Mixer root** — the player wrapper (`orientCharacter` result) contains the bone subtree; `new
  AnimationMixer(wrapper)` resolves `"<bone>.quaternion"` tracks by name. (Confirm the wrapper rotation
  doesn't fight bone tracks — bones are local to the skinned mesh, so it shouldn't.)
- **animgrp.dat** — hardcode the `man` group now; parse the file for per-ped gaits later.

## Out of scope (later)

The `anim.img`/`cuts.img` broader animation sets, IFP `ANPK`/older variants, blend trees / partial-body
layering (upper-body aiming), foot IK / true root motion, weapon & vehicle anims, facial animation, and
loading anims by ped type from `animgrp.dat`.
