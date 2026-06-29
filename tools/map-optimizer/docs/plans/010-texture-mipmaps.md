# 010 — Generate texture mipmaps (TXD)

**Status: ✅ Implemented (Phases 1–2).** Add a **texture** axis: for TXD textures that ship without a full mip
chain, generate one offline and write it back **into the native TXD** (no custom format). Uncompressed
textures get an 8888 + mips rebuild; **DXT textures stay DXT** — the base level is kept byte-for-byte
(lossless) and only the downsampled mips are re-encoded (BC1/BC3), so there's **no 8888 size blow-up**.

## Context / problem

The engine builds a **`CompressedTexture`** for DXT and only selects `LinearMipmapLinearFilter` when a texture
already carries **multiple levels** (`src/renderware/three/build-texture.ts`). **WebGL can't generate mipmaps
for compressed textures at runtime**, so single-level DXT textures (common in mods) shimmer/alias at distance
with no load-time fix. Generating the chain offline is the only option — written back into the **standard TXD**
so the engine (and the game) load it natively.

## Decisions

- **Native TXD, no custom format.** Mip levels go into the existing `TextureNative` chunk. The RW container is
  already handled by our `chunk.ts` (TXD = `TextureDictionary 0x16` / `TextureNative 0x15`), so we descend to a
  texture's `Struct` and replace it; **untouched textures are preserved byte-for-byte**.
- **Per format:**
  - **Uncompressed** (8888 / expanded 16-bit / palette→RGBA): decode the base to RGBA (reuse `../src`
    `parseTxd` read-only), box-downsample the chain, re-store as **8888** (BGRA) with all levels.
  - **DXT1/3/5 (Phase 2):** **decode** the base → RGBA, downsample, **re-encode each mip back to the same DXT
    format** (our BC1/BC3 encoder), and keep the **original base level untouched** (lossless). DXT stays DXT.
- **Opt-in pass (`--textures`).** It's not in the default model pipeline — it changes textures and only matters
  where the engine can't runtime-mip (compressed). With Phase 2, DXT adds only ~33% (the mips), not ~8×.
- **Only fill missing chains.** Process a texture iff it has **one level**, is **power-of-two**, and a known
  format; skip already-mipped / NPOT / unknown (reported, left untouched).
- **Downsample** = 2×2 box average to 1×1 (sRGB-correct averaging is a cheap follow-up).
- **Output:** rebuilt TXDs go into the same `--out` build next to the optimized models (the per-archive rebuild
  of [011](./011-full-build-output.md)).

## Phase 1 building blocks (this iteration)

- **`codec/dxt.ts`** — DXT1/3/5 **decoder** → RGBA (pure; the only "compression" code Phase 1 needs).
- **`lib/mip.ts`** — box `downsample` + `buildMipChain` (pure).
- **`codec/texture-native.ts`** — write an **8888 `TextureNative` Struct** from RGBA levels; read a Struct's
  name (to match + decide skip). Identity for untouched textures comes free from the chunk codec.
- **`adapters/gta-sa/textures.ts`** — resolve the map's TXDs (`placedModels().txds`) from the archives, run the
  mip pass, pack into the `.img`.
- **`plugins/generate-mipmaps.ts`** + an opt-in `--textures` flag on the CLI; texture stats in the report.

## Scope

- **In (Phases 1–2):** native-TXD mip generation — DXT decoder, box downsampler, 8888 writer (uncompressed),
  **BC1/BC3 encoder** (DXT stays DXT, base preserved); texture resolution + opt-in `--textures` pass + `.img`
  output; tests (decode, encode round-trip, mip math, 8888 + DXT TextureNative round-trips) + a gostown run.
- **Out (later):** sRGB-correct downsampling; NPOT handling; texture resizing/atlasing; higher-quality DXT
  endpoint refinement (current encoder is fast/bbox-class — fine for mips).

## Risks / testing

- **8888 `TextureNative` fidelity** is the gate — the produced TXD must re-parse via `../src` `parseTxd` and
  build in the engine (`buildTextureMap`): correct name/dims, `numLevels`, and pixel round-trip. Untouched
  textures stay byte-identical (chunk codec).
- **DXT decoder correctness** — unit-tested against known blocks (solid + interpolated colours, DXT3/5 alpha).
- **Size blow-up** is real and surfaced — opt-in + reported, fixed properly in Phase 2.
- **In-game visual** (less distance shimmer) is the true quality check — not auto-verifiable here.
