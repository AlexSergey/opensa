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

1. **IFP (ANP3) parser.** `renderware/parsers/binary/ifp.ts` `parseIfp(buffer): IfpAnimation[]` —
   `IfpAnimation { name; bones: IfpBone[] }`, `IfpBone { name; boneId; frames: IfpKeyframe[] }`,
   `IfpKeyframe { rotation:[x,y,z,w]; translation?:[x,y,z]; time:number }` (renderer-agnostic). Tests on a
   synthetic ANP3 (one anim, a couple bones, types 3 & 4).

2. **AnimationClip builder.** `renderware/three/build-anim-clip.ts`
   `buildAnimationClip(anim: IfpAnimation): THREE.AnimationClip` — per bone a `QuaternionKeyframeTrack`
   `"<bone>.quaternion"` (+ `VectorKeyframeTrack` `"<bone>.position"` for type-4 root), times in seconds.
   Bone names trimmed to match the skeleton; **strip root horizontal (X/Y) translation** (physics drives
   position; keep vertical bob optional). Quaternion conversion isolated so the sign convention can be
   flipped in one place. Tests on a synthetic `IfpAnimation`.

3. **Adapter seam + AnimationController (single clip).** `WorldAdapter.loadAnimations(ifpUrl):
   Promise<Map<string, AnimationClip>>` (fetch → `parseIfp` → `buildAnimationClip` per anim, keyed by lower
   name). `game/character/animation-controller.ts`: an `AnimationMixer` on the player render object (its
   subtree holds the named bones), `play(clipName, fade?)`, `update(delta)`. **Browser checkpoint:** force
   `WALK_civi` and confirm Tommy animates upright (validates parse + bone mapping + quaternion convention;
   tune the quaternion flip / time scale here).

4. **Locomotion state machine.** `character-animation.system.ts` (a `System`): each `update`, read planar
   speed (`physics.getLinvel`) + grounded (`physics.isGrounded`) + sprint key → choose state
   (idle / walk / run / sprint / jump) → crossfade (~0.15–0.2 s) via the controller; `mixer.update(delta)`.
   Hardcode the `man` mapping: idle=`IDLE_stance`, walk=`WALK_civi`, run=`run_civi`, sprint=`sprint_civi`,
   air=`JUMP_glide`. Gate on `gameState === 'play'`. Wire-in via the bootstrap (load `ped.ifp`, build the
   controller on `character` handles, register the system). **Browser acceptance:** standing = idle, moving
   = walk, fast = run, airborne = jump; smooth blends; camera/collision unchanged.

5. **Jump sequence + polish.** `JUMP_launch` (rising) → `JUMP_glide` (falling) → `JUMP_land` (on touch),
   thresholds tuned; run/sprint split by speed or the sprint key; optional `animgrp.dat` parsing for ped
   gait groups. Tune walk/run speed thresholds + crossfade.

6. **(Secondary) `anim.img` packer.** `scripts/pack-anim-img.mjs` — bundle `static/anim/anim.img/` (133
   IFPs) into a WIMG archive (reuse `scripts/pack-img.mjs`: `WIMG0001` header + JSON dir + concatenated
   data). Decide the output path (folder is named `anim.img`; output e.g. `static/anim/anim.img.wimg` or a
   configurable `ANIM_OUT`). Lets the broader activity animations load like the model archive later. Not on
   the walk/run/jump path.

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
