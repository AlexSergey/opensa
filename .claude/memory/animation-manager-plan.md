---
name: animation-manager-plan
description: Plan 012 — animation manager (walk/run/jump/idle) driving Tommy's skeleton from ped.ifp (ANP3)
metadata:
  type: project
---

Plan: `.claude/plans/012-animation-manager.md`. Drive Tommy's skeleton ([[character-model-plan]], `CharacterContext.skeleton`/`bonesByName`) with GTA SA animations from `static/anim/ped.ifp` — an animation manager that plays **idle/walk/run/jump** and crossfades by movement state.

**Verified everything is present:** `ped.ifp` is **ANP3** (294 anims, parses end-to-end). Locomotion clips exist: `WALK_civi, run_civi, sprint_civi, IDLE_stance, JUMP_launch/glide/land`. **IFP bone names match the skeleton exactly** (32/32 for WALK_civi: `Root, Pelvis, … R Toe0` after trim) → map tracks→bones by name. Root bone = frame type 4 (rot+translation), others type 3 (rot only). `static/data/animgrp.dat` = ped gait groups (hardcode `man` for now). `static/anim/anim.img/` = 133 activity IFPs (NOT needed for walk/run/jump; a WIMG packer is a secondary deliverable).

**ANP3 layout:** `"ANP3", u32 size; char[24] internalName, i32 numAnims; per anim {char[24] name, i32 numBones, i32, i32; per bone {char[24] name, i32 frameType, i32 frameCount, i32 boneId; per frame: i16 rot xyzw /4096, i16 time, if type==4: i16 pos xyz /1024}}`. Names have a trailing 3ds-max path after the NUL (read to first NUL).

**Iterations:** 1) `renderware/parsers/binary/ifp.ts` `parseIfp` (ANP3 → `IfpAnimation[]`, no three); 2) `renderware/three/build-anim-clip.ts` (→ `THREE.AnimationClip`, bone-name tracks, **strip root X/Y translation** since physics owns position); 3) `WorldAdapter.loadAnimations(ifpUrl)` + `animation-controller.ts` (AnimationMixer on the player wrapper) — browser-check forcing WALK to validate quaternion convention + time scale; 4) `character-animation.system.ts` state machine (planar speed via `physics.getLinvel` + `isGrounded`, no controller changes) → crossfade idle/walk/run/sprint/jump; 5) jump launch→glide→land sequence + polish; 6) secondary `scripts/pack-anim-img.mjs`. **Open (tune in browser, isolated in build-anim-clip):** IFP quaternion sign (conjugate?) + i16 time→seconds scaling.
