# Character

`packages/renderware/src/three/build-skinned-clump.ts`, `build-anim-clip.ts`,
`packages/game/src/character/`, plans 008/011/012/013/036.

## Implemented

- **Skinned model**: Skin plugin → `SkinnedMesh` + `Skeleton`; bones from the frame hierarchy
  (skin bone i ↔ frame i+1, frame 0 = dummy root); bind pose = raw mesh regardless of mapping;
  named-bone map for animation retargeting. Current model: the selected game's `mainCharacter` (a `peds.ide`
  ped, e.g. `BMYPOL1`; `apps/web/src/game-config.tsx`), loaded via `adapter.loadCharacterByModel`.
- **Root anchoring** (`anchorRootBone`): the root bone's rest position is snapped to the skin's authoritative
  bind translation (`inverse(boneInverse)`). The IFP root **translation** track is dropped (locomotion stays
  in-place — physics owns position), so the root bone would otherwise keep its DFF **frame** position. Standard
  peds author that at the origin (matching the skin bind), but some mods offset the root frame (e.g. gostown's
  `BMYPOL1` puts `Root` at +2.16) — which would shove the whole body off the entity pivot (off-centre, with
  rotation orbiting the offset). The snap is a no-op when the frame and skin bind already agree.
- **Animation** (plan 012): ANP3 IFP parsing (quaternions i16/4096, times i16, root translation
  i16/1024), `buildAnimationClip` (quaternion tracks by bone name; translation opt-in);
  `ped.ifp` is loaded **directly** (`loadAnimations(ifpUrl)` → `anim/ped.ifp`, no packed archive);
  `CharacterAnimationSystem` (idle/walk/run
  states, speed-matched locomotion — root motion stripped, physics owns position).
- **Physics** (plans 008/013): bitECS entity + Rapier capsule/box controller, gravity, map
  collision, jump, slope handling; respawn/teleport debug actions. The game's `playerSpawn`
  (`GAME_CONFIG`, `apps/web/src/game-config.tsx`) is the single source for where the player starts — it seeds both the
  player capsule and the initial collision zone (`loadGame` centres on it), so there is ground under the drop
  (Ganton on `original`).
- **Night fill** (plan 034) so the player reads at night.
- **Follow camera** (plan 036): spherical rig in `Config.camera`; auto-trail only on direction
  CHANGE (not continuous), free mouse look wins, pitch manual-only; zoom wheel with min/max;
  debug Camera screen sliders.

## Known gaps / candidates

- Single character model; no CJ/ped variety, no ped NPCs.
- Animation set is locomotion + vehicle enter/exit; no combat/swim/climb.
- IFP translation tracks unused for the player (physics-driven) — used for map objects instead.

## Test coverage anchors

`build-skinned-clump` tests (incl. real fixtures: stock `army`/`bmypol1`, renamed-root `Shrek`, and
offset-root `gostown-bmypol1` for `anchorRootBone`), `build-anim-clip` tests, `ifp` parser tests,
`character-controller.system.test.ts`, camera tests.
