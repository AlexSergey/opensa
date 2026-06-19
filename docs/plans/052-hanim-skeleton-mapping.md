# 052 — HAnim-based skeleton bone mapping (skinned peds)

## Context

`build-skinned-clump.ts` builds a character `Skeleton` from a skinned DFF. The skin's per-vertex
`boneIndices` reference bones in a specific order; we currently map **skin index `i` → frame `i + 1`**
(frame 0 is the dummy clump root) — a positional heuristic.

That order is actually defined by the RenderWare **HAnim** plugin (chunk `0x11e`), which we do **not**
parse. Each frame's HAnim carries its `boneId`; the **root** frame's HAnim carries the **hierarchy** — the
ordered `boneId` list that the skin's indices map into. The frame order and the hierarchy order are NOT the
same in general.

Byte-verified on two real peds (both 33 frames / 32 skin bones / 32 HAnim chunks):

| Model                                   | per-frame boneIds (frame order)       | root hierarchy ids (skin-index order) | `i+1` correct?                                                                     |
| --------------------------------------- | ------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| `tommy.dff` (army, **original SA ped**) | `0,1,51,41,2,201,3,301,302,4,21,31,…` | `0,1,2,3,4,5,8,6,7,31,32,33,…`        | **No** — orders differ → vertices bind to the wrong bones (mesh collapses/inverts) |
| `tommy2.dff` (custom Tommy)             | `0,1,2,3,4,5,8,6,7,31,32,33,…`        | `0,1,2,3,4,5,8,6,7,31,32,33,…`        | Yes (coincidence — frame order == hierarchy order)                                 |

So the custom Tommy happened to line up; a standard SA ped (army) does not, and renders mis-skinned.

## Decision

**HAnim is the primary path** (correct for every standard SA ped, and for Tommy). The positional `i+1`
heuristic becomes the **fallback** only for skinned models that carry **no HAnim** at all.

## HAnim chunk layout (`0x11e`, byte-verified)

`version u32, boneId u32, numNodes u32`. When `numNodes > 0` (the root/hierarchy frame): `flags u32,
keyFrameSize u32`, then `numNodes × { nodeId u32, nodeIndex u32, flags u32 }` (12 B each). The skin's
bone index `i` corresponds to `nodeId` at hierarchy position `i`.

## Steps

1. **Constants:** add `HANIM_PLG: 0x11e` to `RwSection`.
2. **Parser (`dff.ts` `parseFrameList`):** while walking each frame's Extension (already done for the
   frame name), also read the HAnim PLG → set `RWFrame.boneId`; on the frame that carries the hierarchy,
   set `RWFrame.boneHierarchy: number[]` (the ordered `nodeId`s). Add both optional fields to `RWFrame`
   (`types.ts`).
3. **Skeleton (`build-skinned-clump.ts`):** if any frame has `boneHierarchy`, build
   `boneByBoneId: Map<boneId, Bone>` from the frames' `boneId`, then
   `skinBones[i] = boneByBoneId.get(hierarchy[i])`. Else fall back to the current `bones[i + 1]`.
   3b. **Inverse binds from the skin (found during impl — fixes the "lying down" orientation).** Ordering
   alone made army's mesh recognizable but still **rotated 90°**: its frame bind pose (Root rotated
   −90°/−90°) differs from the skin's true bind, so three's frame-derived inverse-binds were wrong (Tommy's
   frames happened to match, so it looked fine). Fix: after `mesh.bind(skeleton)` (which computes
   frame-derived inverses), **override `skeleton.boneInverses` from the skin plugin's own
   `inverseBindMatrices`** — the authoritative bind pose. RW stores them as padded `RwMatrix`
   (right/up/at/pos, each + a pad float; the homogeneous `[15]` reads 0), so force the bottom row to
   `(0,0,0,1)`. Must run **after** `mesh.bind` — `bind()` with no explicit `bindMatrix` calls
   `skeleton.calculateInverses()` and would clobber it. Verified: army + Tommy both stand (skinned-mesh
   bbox tallest along +Z).
4. **Tests / fixtures:**
   - The custom **Tommy** model is committed at `tests/custom/character/tommy.dff` (non-Rockstar); the
     `build-skinned-clump` + adapter-integration tests read it from there.
   - **army** (stock SA ped) regenerates from `gta3.img` into `tests/original/character/army.dff` via the
     `test-fixtures` manifest (`extract('army.dff', …)`), gated by `existsSync` (CI-absent).
   - Synthetic tests cover the logic directly: HAnim order vs frame order, the no-HAnim `i+1` fallback,
     and the skin inverse-bind `[15]→1` repair. The army test is the real-ped regression guard
     (`skeleton.bones[0..3]` = `Root,Pelvis,Spine,Spine1`, not the frame order with `R Thigh` early).

5. **Asset-load case-insensitivity (found alongside):** the build lowercases all packed asset keys, but
   `loadCharacter` / `loadAnimations` looked them up verbatim — a `player/Shrek.dff` request (capital S)
   threw `asset not found` and crashed startup. Both now `.toLowerCase()` the name before the VFS lookup.

## Risk

Touches the core skinned-skeleton build (every character). Mitigations: HAnim is the documented RW
mechanism (matches the game), the fallback preserves behaviour for HAnim-less models, and the bind-pose
mechanism is unchanged (only bone order). Regression guard: Tommy + army fixtures + full suite.

## Step 6 — root-track aliasing for renamed roots (Shrek)

Animation retargeting maps tracks to bones **by name**. A standard ped's root bone is `Root`/`Normal`, so
the IFP root track lands on it. But some mods **rename the root** (Shrek's is `MrAndres5555`), so the root
track matched nothing and was dropped → the body stayed at its bind facing (spawned back-to-car, animations
played reversed, e.g. sitting feet-into-the-trunk). Verified via probe: aliasing the root track onto
`skeleton.bones[0].name` flips Shrek's forward from `-Y` to `+Y`.

Fix (`animation-controller.ts`): `AnimationController` / `retargetClip` take an optional `rootBoneName`;
`boneResolver` aliases the `root` key onto it (`byKey.set('root', rootBoneName)`). `canvas-host.tsx` passes
`character.skeleton?.bones[0]?.name`. Standard peds are unaffected — they already have a `Root` bone, so the
alias is redundant; only renamed-root models change. Guarded by two synthetic `retargetClip` tests (renamed
root with and without `rootBoneName`) plus a **real** regression in `build-skinned-clump.test.ts`: the
committed `tests/custom/character/Shrek.dff` builds a 32-bone skeleton whose root really is `MrAndres5555`
(no stock `Root`/`Normal`), confirming the model fact the fix depends on.
