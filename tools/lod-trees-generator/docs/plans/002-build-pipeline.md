# 002 — build pipeline (HD trees → LOD impostors)

> **CLI note (as-built):** the original `--dff`/`--txd` were **unified into one `--in`** (a folder with both the
> `.dff` and `.txd`). **Omitting `--in`** bakes the built-in SA tree roster (`@opensa/map-placement/vegetation`)
> straight from the game's `gta3.img` — no model/texture swap. The plans' prose still says "`--dff`/`--txd`"; read
> it as `--in`.

**Status: ✅ Done (P1–P7).** A folder of HD tree DFFs → SA-style LOD impostors: per-tree `lod<Name>.dff` +
one shared `lodtrees.txd` (atlas) + one shared `lodtrees.col`. All stages verified by round-tripping the output
through the engine's parsers (`parseDff`/`parseTxd`/`parseColLibrary`); the COL matches the `lodCedar1_hi`
reference (bounds-only COL3). Pure TS — no GL/browser/native deps. Follow-ups: bilinear sampling, configurable
prelit tint, DXT atlas option, in-game look check.

## Decisions

1. **Renderer = pure-TS software orthographic rasterizer.** No GL / browser / native deps — runs in Node, is
   deterministic + unit-testable, and matches the project's all-TS codec style (rw-codec already does DXT/mip in
   TS). It's offline + one-shot, so perf is irrelevant. Per card: orthographic projection of the HD mesh onto the
   card plane → scanline raster with **affine** UV interpolation (orthographic ⇒ exact, no perspective divide) →
   sample the HD texture (DXT-decoded to RGBA) → alpha-test → z-buffer; background stays **α=0**.
2. **Atlas = one shared TXD for the whole `--in` batch** (like `LODvegetation.txd`), with **one named texture per
   tree** (`lod<Name>`); each per-tree texture is itself a **mini-atlas of its N card views**. _(My recommendation
   for #4 — mirrors SA exactly, one TXD = fewer files/draw-state. The alternative, one TXD per tree, is wasteful.)_
3. **Texture size configurable** — `--tex <px>` (default 256), the per-tree texture; the N card views tile inside
   it. (So you can A/B 128/256/512 in-game for quality — requirement #3.)
4. **Cards configurable** — `--cards <n>` (default 4): crossed **full-bbox vertical quads** + alpha cutout. The
   alpha trims the silhouette, so plain rectangles suffice (the SA hand-made cards are trimmed only to cut
   overdraw). **Strictly fit to the HD bbox** (centre + X/Y/Z extents) — requirement #2.
5. **COL = per-tree COL3 with `bounds` only, empty geometry** — exactly what `lodCedar1_hi` ships (boxes/faces/
   spheres/verts all 0). Collected into one `.col` library. Needs a tiny new COL3 writer (only a decoder exists).
6. **Outputs → `--out`:** `lod<Name>.dff` per tree + one atlas `.txd` + one `.col`. IDE/IPL **out of scope**.
7. **Paths:** `--in` / `--out` resolved **relative to the tool dir** (`tools/lod-trees-generator/`) — requirement
   #1; `--game` relative to cwd (repo root, where `game-src/` is) or absolute.

## Pipeline (per tree, then batch)

| Phase          | Module                                    | Does                                                                                                                                                                                                                                                                                                  | Reuse / new                                                                |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **P1 Load HD** | `adapters/gta-sa/io.ts`                   | parse DFF, bake its **atomics** (each geometry placed by its **frame transform** — multi-atomic / frame-offset models else assemble wrong); positions/uvLayers[0]/triangles/materials/prelit/bbox; resolve TXD via `--game` `gta.dat`/IDE (model→txd) + `gta3.img`; **decode** each HD texture → RGBA | `parseDff`/`parseTxd`/`parseGtaDat`/`parseIde`/`openArchive` + `decodeDxt` |
| **P2 Render**  | `core/raster.ts` (+ `gta-sa/impostor.ts`) | orthographic raster of the HD mesh per card angle → RGBA tile (α cutout)                                                                                                                                                                                                                              | **new** rasterizer + view projection                                       |
| **P3 Atlas**   | `core/atlas.ts`                           | pack N card tiles → per-tree texture; collect trees → atlas + per-card UV rects                                                                                                                                                                                                                       | **new** grid packer                                                        |
| **P4 LOD DFF** | `gta-sa/encode-dff.ts`                    | card geometry fit to bbox + UVs→tiles + flat prelit; encode to DFF                                                                                                                                                                                                                                    | `encodeDff` + geometry-rebuild (template-based)                            |
| **P5 TXD**     | `gta-sa/encode-txd.ts`                    | atlas → TXD (DXT + mips + alpha)                                                                                                                                                                                                                                                                      | `encodeDxt` / texture-native / `mip`                                       |
| **P6 COL**     | `gta-sa/encode-col.ts`                    | per-tree bounds-only COL3 → `.col` library                                                                                                                                                                                                                                                            | **new** minimal COL3 writer                                                |
| **P7 Write**   | `core/pipeline.ts` finalize               | emit `lod*.dff` + atlas `.txd` + `.col` to `--out`                                                                                                                                                                                                                                                    | fs                                                                         |

## Capabilities confirmed

- `@opensa/rw-codec/dxt` → `decodeDxt(format, data, w, h)` (BC1/3/5 → RGBA) and `encodeDxt` (RGBA → BC1/3/5).
- `@opensa/rw-codec/texture-native` + `mip` → re-encode TextureNative structs with mips.
- map-optimizer `encodeDff` + `geometry-rebuild` → rebuild a geometry into DFF bytes (template-driven).
- COL: only a parser (`parseColLibrary`) exists → **write a COL3 encoder** (bounds + zero counts; trivial given
  LOD models carry no real collision).

## Open / to confirm while implementing

- HD texture resolution: a model's materials name textures (e.g. `tree_branches44`); we load them from the
  model's IDE `txdName` TXD. If a name is missing there, warn + render that face flat (don't hard-fail).
- Exact card cage angles (default even spread 0…180° around vertical Z) + whether to add a horizontal "canopy"
  card. Start with N vertical crossed cards; revisit after seeing it in-game.
