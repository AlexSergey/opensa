---
name: player-cube-placeholder
description: HISTORICAL — the 3ds cube placeholder was replaced by the Tommy DFF character (plan 011)
metadata:
  type: project
---

**Resolved (plan 011, [[character-model-plan]]).** The player is no longer a placeholder. The original temporary cube (`static/player/player.3ds` + `game/character/load-player.ts` `loadPlayerMesh`, loaded via `TDSLoader`) has been **removed**. The player is now the **Tommy Vercetti** skinned DFF (`static/player/tommy.dff` + `tommy.txd`), loaded via `WorldAdapter.loadCharacter` → `buildSkinnedClump` (a real `SkinnedMesh` + `Skeleton`, bind pose), stood up with `game/character/orient-character.ts` `orientCharacter`, and wired through `setupCharacter` (which still owns the physics box + ECS + camera — unchanged, model-agnostic). Kept this note (rather than deleting) so older `[[player-cube-placeholder]]` links resolve; the load seam moved from `load-player.ts` (gone) to `adapter.loadCharacter`.
