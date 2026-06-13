# Procedural stochastic texturing (de-tiling)

**Status: parked — not doing yet.** Investigated the selection problem, found no clean signal, and
shelved it (owner decision). No code was written.

## Idea

Large surfaces tiled with a repeating texture (ground, sand, grass, roads, terrain) show obvious
periodic **tiling repetition** — the same texel pattern marching across the surface. Procedural
**stochastic texturing** hides it by sampling the texture at randomised offsets per local tile and
blending, so the macro-repetition disappears while the micro-detail stays.

## Approach options

1. **Histogram-preserving (Heitz & Neyret 2018, "Procedural Stochastic Textures by Tiling and
   Blending").** Blend 3 randomly-offset samples on a triangular grid, but in a Gaussianized colour
   space + an inverse-histogram LUT, so the result keeps the original contrast (naive blending washes
   seams to grey). Highest quality. Cost: ~3 texture taps + 1 LUT tap, plus a per-texture precompute
   (Gaussianize + LUT). **Conflicts with our DXT-compressed textures** — would need offline
   decode/recompress + extra LUT textures.
2. **Simple triangular-grid blend (no histogram preservation).** Same 3-tap blend without the
   Gaussian/LUT machinery. Works directly on DXT; ~3 taps; some contrast loss / slight haze in the
   blend bands but often "good enough" at gameplay distances. This was the chosen first target.

## Decisions made before parking

- Implement as a **`WorldMod`** (optional, toggleable, `decoratePart` shader inject like wind) — not
  engine core.
- Start with the **simple 3-tap** variant.

## Why it was parked: no clean selection signal

It must be **selective** (~3× texture fetches — applying it everywhere would triple texture bandwidth
for no benefit on non-tiled surfaces). We tried to gate on **UV tiling factor** (UV span per
geometry), but a survey killed it:

```
UV-span buckets over 1527 geometries:  ≤1: 224  ≤2: 160  ≤4: 115  ≤8: 649  ≤16: 302  >16: 77
```

Heavy UV tiling is the **norm** in SA, not a ground signal — walls, fences, rooms, floors all tile
with span 7–12 (`a51_extfence*` 7–12, `a51_genroom` 8, `a51_fakeroom2` 12.5). So UV-span would apply
the effect to almost everything. No other clean data signal for "tiled ground" exists; the remaining
options are an explicit texture/model **allow-list** (needs curation) or a broad debug-toggle
prototype (perf cost). Owner chose to defer rather than commit to a fuzzy allow-list now.

## When picked up

- Decide selection first (allow-list of ground/road/sand/grass textures, or a broad
  near-camera-only prototype behind a debug toggle to find what actually needs it).
- Then the simple 3-tap mod: `decoratePart` shader inject replacing the world material's
  `#include <map_fragment>` with a triangle-grid stochastic sample (textureGrad for correct mips),
  composing with the existing world-material `onBeforeCompile`. Skip alpha cutouts + UV-anim materials.
- Histogram-preserving only if the simple variant's contrast loss is too visible.
