---
name: character-physics-plan
description: Plan 008 — first character spawn with bitECS + Rapier physics, collision, follow camera
metadata:
  type: project
---

Plan: `.claude/plans/008-character-physics.md`. Spawn the first **player** (TEMP cube, see [[player-cube-placeholder]]) on CJ's parking lot in Ganton (`GANTON_CJ_HOME = [2495,-1687,13]`, Z-up), with gravity + collision against the real map COL (from [[col-collision-plan]]'s `CollisionWorld`), a **follow camera**, and keyboard control in **play** mode when grounded. First real test of the COL collision and first slice of dynamics — via **bitECS** (entities/components/systems) + **Rapier** (`@dimforge/rapier3d-compat`, needs `await init()`).

**Key decisions:** physics + ECS run in **GTA Z-up** (Rapier gravity `(0,0,-9.81)`); the `−90°X` is display-only — `CollisionWorld` colliders go to Rapier as-is (model-space verts + Z-up placement per fixed body, no baking). Player `Object3D` sits under a new `Game.entityRoot` (`−90°X`), sibling of the region group; camera follows `player.getWorldPosition()` (Y-up). New `Config`: `gameState: 'play'|'pause'` + remappable `controls` keymap. New deps: `@dimforge/rapier3d-compat`, `bitecs`. `Game` gains `addSystem()` + `entityRoot`. Player model loaded via `three/addons` `TDSLoader` behind a `loadPlayerMesh` seam (→ DFF later).

**Module layout (generic `game` layer):** `game/ecs/` (world, components, queries), `game/physics/` (rapier init, physics-world, physics.system), `game/character/` (load-player, character-controller.system, render-sync.system), `game/input/keyboard.ts`, `core/camera-controller` gains follow mode.

**Iterations (each green):** 0 deps+seams (`addSystem`, `entityRoot`, `initRapier`) → 1 cube on lot (static) → 2 bitECS Transform + render-sync → 3 Rapier gravity + temp ground (falls/rests) → 4 real map colliders from `CollisionWorld` → 5 play/pause + keyboard + grounded control → 6 follow camera → 7 PLAY/PAUSE UI + polish. Status: **planned, not started.**
