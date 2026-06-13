# Alpha cutout black edge (foliage / fences)

**Status: shelved.** Investigated thoroughly; every approach we tried either left a residual dark
artifact or regressed other cases. Reverted to the original behaviour (textured alpha = soft alpha
blend, `transparent` + `alphaTest 0.5`, `DoubleSide`) until someone returns with a complete fix.

## Symptom

Alpha-tested/blended map props — trees, bushes, fences, chain-link, window cutouts — show a dark
fringe around the cutout edges (the classic GTA SA "black outline on alpha"). It reads as a faint
**dark square/halo** around foliage, most visible when the prop is in front of a mid-tone background
(a building) rather than the bright sky, and as a slight moving "trail" when the tree sways (wind).
The community plugin **SkyGfx** addresses the SA version with `dualPassWorld=1`.

## Root cause (verified)

The texture itself stores **black RGB in its transparent texels**, and bilinear + mipmap filtering
bleeds that black into the visible edges.

- DXT1 1-bit-alpha mode forces transparent texels to black by spec (`palette[3] = [0,0,0]`).
- DXT3 cutouts were authored with black in the transparent regions too. Decode of real map textures:
  `vgsebushes` foliage transparent-texel RGB ≈ 2 (≈ black); `Upt_Fence_Mesh` / `fence_64` ≈ 0.
- So even pure alpha-test (no blend) shows dark edges, because the kept edge texels' RGB is
  bilinear-filtered toward the black transparent neighbours; and mip minification averages the large
  black transparent gaps between leaves back into the edges at distance.

Not a depth/sorting/blend-ordering bug (we confirmed by removing blending entirely and the fringe
persisted). The DXT1 `hasAlpha` flag is reliable (82 truly-transparent DXT1 textures sampled, 0
mismatches — an early scan miscounted flat `c0==c1` blocks as transparent; real transparency = a
`c0<=c1` block with a texel using colour index 3).

## Approaches tried

1. **Opaque alpha-test cutouts** (`transparent:false` + `alphaTest 0.5`). Cheapest. **Regressed**:
   foliage textures have *soft* (anti-aliased) alpha; the hard 0.5 cutoff rendered their
   semi-transparent texels solid → **dark squares** on bushes/trees. Reverted.
2. **Texture edge dilation** (`build-texture.ts` + a ported `dxt-decode.ts`): decode alpha textures
   DXT→RGBA, flood every transparent texel's RGB to its nearest opaque colour (full O(N) BFS, not a
   capped pass count — a cap left big leaf gaps black and the mips re-bled them), upload as
   `DataTexture` with regenerated mips; keep the original soft blend. **Best black-removal of the lot**
   and cheap at runtime, but a faint residual dark square still remained (dark-green leaf colour near
   the edges + straight-average mips). VRAM cost: alpha textures become RGBA (×4 their DXT size), a
   minority of textures.
3. **SkyGfx dual-pass** (`world-material.ts` + `build-clump.ts`): draw each textured cutout twice
   (same geometry, two parts from `buildClumpParts`) — a CORE (opaque, `alphaTest 0.5`, depth-write,
   alpha ≥ ref) + a FRINGE (blended, no depth-write, in-shader `discard` of alpha ≥ ref, the soft
   alpha < ref edge). Looked **about the same as dilation** — better than the original, but the
   artifact still remained.

## Outcome

Dilation and dual-pass gave the best results, but neither fully removed the artifact, so both were
reverted. Shelved as an open issue.

## Notes for whoever picks this up

- Likely the complete fix needs **alpha-weighted (premultiplied) mipmap generation** (weight RGB by
  alpha when downsampling so transparent/dark texels don't pollute the mip) — possibly combined with
  edge dilation for the base level. Three's auto `generateMipmaps` does a straight average.
- `alphaToCoverage` is NOT available on the main path: the PostFX composer renders without MSAA (it
  uses SMAA as a post pass). It would only help on the no-post-fx debug path.
- Both dilation and dual-pass implementations are recoverable from git history (this session). The
  DXT software decoder also exists in `scripts/dump-texture.ts`.
- Diagnostic gotcha: the in-engine texture cache (`asset-cache`) **survives HMR** — texture-pipeline
  changes need a **full page reload** to take effect, or it looks like "nothing changed".
- Safe-to-touch note: additive coronas/particles gate on alpha (corona uses the texture only for
  alpha; particles `discard` low alpha), so texture RGB changes there are invisible.
