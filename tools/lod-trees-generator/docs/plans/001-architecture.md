# 001 — lod-trees-generator architecture

**Status: 📝 Scaffolding (CLI + core/adapter skeleton landed; bake pipeline pending spec).**

Generate **GTA-SA-style tree LOD impostors** from HD tree models: the cheap distant-view stand-in that SA ships as
`lod<Name>` — a handful of crossed flat "cards" textured with a baked alpha snapshot of the tree (see the
`lodCedar1_hi` analysis below). New tool under `tools/`, same shape as the other tools (`core/` game-agnostic +
`adapters/gta-sa/` + a thin `cli.ts`).

## What an SA tree LOD actually is (reference: `cedar1_hi` → `lodCedar1_hi`)

|           | HD `cedar1_hi`                               | LOD `lodCedar1_hi`                                        |
| --------- | -------------------------------------------- | --------------------------------------------------------- |
| geometry  | 350 verts / 170 tris                         | **13 verts / 9 tris**                                     |
| materials | 2 (`bthuja1` bark, `cedarbare`+mask foliage) | **1** (baked atlas slice + alpha mask)                    |
| shape     | real trunk + branches + canopy               | ~4 **crossed billboard cards** in the same bbox (~9×9×22) |
| shading   | prelit                                       | flat dark prelit (`70,70,70`), no normals                 |

So a LOD = **render the HD tree to an alpha texture** (foliage silhouette with cutout) → map slices of that atlas
onto a few flat cards arranged as crossed vertical planes spanning the HD bounding box → bake one flat dark prelit
tint → one draw call, ~19× fewer triangles. (This is exactly the "render DFF+TXD to an alpha texture" technique.)

## CLI

```
tsx tools/lod-trees-generator/src/cli.ts --in <path> --out <path> --game <path>
  --in    directory of HD tree DFFs (or a single .dff) to make LODs for
  --out   directory to write the generated LOD DFFs + atlas TXD(s)
  --game  path to the game data (gta.dat / IDE / IMG) — resolves each model's TXD + object defs
```

(The full bake flags — atlas size, card count, draw distance — live in `src/config.ts` and will be exposed as
flags once the algorithm is settled.)

## Architecture (mirrors `opensa-lod-generator`)

```
src/
  cli.ts              parse --in/--out/--game, validate, build adapter, run pipeline
  config.ts           bake knobs (atlasSize, cards, drawDistance)
  core/               GAME-AGNOSTIC
    types.ts          TreeLodConfig, HdTree, TreeLodAdapter
    pipeline.ts       generic driver: enumerate → load → (bake → encode → write)
    index.ts          barrel
  adapters/gta-sa/    GTA-SA specifics (DFF/TXD/IDE via @opensa/renderware, encode via @opensa/rw-codec)
    index.ts          createGtaSaTreeLodAdapter({ in, out, game, config })
```

## Pipeline stages (per HD tree)

1. **Enumerate** input DFFs (`--in`). _(done)_
2. **Load HD** — parse DFF (geometry, materials) + resolve its TXD from `--game` (gta.dat/IDE), load HD textures.
   _(parse + stats done; TXD resolution from `--game` pending)_
3. **Render → alpha atlas** — bake the HD tree to an RGBA texture with **alpha cutout** (the impostor image).
   **← the crux; offline-render approach TBD (see Open questions).**
4. **Build cards** — crossed flat quads spanning the HD bbox, UV-mapped to the atlas slice(s).
5. **Bake prelit** — one flat dark tint, no normals (matches SA LODs).
6. **Encode** — LOD DFF (1 material → atlas) + LOD TXD (atlas, DXT + mips + alpha) via `@opensa/rw-codec`.
7. **Emit** to `--out` (`lod<Name>.dff` + atlas TXD; optionally IDE defs / draw distances).

## Reuse

- `@opensa/renderware` — `parseDff`/`parseTxd`/`buildClump`/`buildTextureMap` (load HD), IDE/gta.dat parsers
  (resolve TXD by model name).
- `@opensa/rw-codec` — DFF/geometry + DXT/texture-native encode for the LOD outputs.
- `@opensa/tool-kit` — mesh/archive helpers if needed.

## Open questions (need the spec)

1. **Impostor texture source (stage 3).** Render offline — how? Options: headless Chromium (reuse the e2e
   SwiftShader path), node-`gl`, or render in the existing browser viewer and feed back. _Or_ a non-render route
   (pack/reuse existing LOD atlases). This decision drives the whole tool.
2. **Card cage** — how many cards, angles, whether a separate top card for the canopy (SA uses ~4 + crown).
3. **Atlas packing** — one atlas per tree, or a shared batch atlas like `LODvegetation.txd` (many trees packed)?
4. **Outputs** — just `lod<Name>.dff` + atlas TXD, or also emit IDE LOD defs / patch the IMG?

## Wiring

Workspace `tools/lod-trees-generator`; eslint `scriptsConfig` + vitest `include` globs added; `out/` gitignored;
linked from `docs/plans/README.md`.
