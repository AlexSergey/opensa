---
name: player-cube-placeholder
description: The player character is TEMPORARILY a 3ds cube, to be swapped for a real DFF model
metadata:
  type: project
---

The first player character is **temporary**: a plain cube at `static/player/player.3ds` (237 bytes, 3ds format), loaded with `three/addons/loaders/TDSLoader.js` (the project has no other 3ds loader — `TDSLoader` was removed in the R3F refactor). Served at `${VITE_STATIC_URL}/player/player.3ds`.

**Why:** a stand-in so character physics/controls/camera can be built and the COL collision tested on a real spawned entity before a real model exists.

**How to apply:** keep the player-model load behind a small seam (`game/character/load-player.ts` `loadPlayerMesh(url)`) and the spawn call site model-agnostic, so it can later be swapped for a real **GTA SA DFF character** loaded via the renderware adapter — without touching physics/ECS/camera. Part of plan [[col-collision-plan]]'s successor, `.claude/plans/008-character-physics.md`.
