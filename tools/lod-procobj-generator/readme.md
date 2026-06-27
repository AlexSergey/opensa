# @opensa/lod-procobj-generator

Convert **GTA-SA procobj scatter species** (bushes, rocks, scrub, joshua…) into **static IPL instances with
simplified-copy LODs** — a decimated low-poly mesh, not a billboard impostor (that's
[`lod-trees-generator`](../lod-trees-generator/)). The companion to it for the procobj clutter the impostor tool
deliberately leaves alone.

```sh
tsx tools/lod-procobj-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path>
```

- `--dff` — procobj HD DFF file or directory; intersected with `procobj.dat` to pick the species to convert
- `--txd` — the HD models' TXD(s); LOD textures are downscaled from here, falling back to the **stock game TXD**
- `--out` — output drop-in directory
- `--game` — game data (`gta.dat` + `data/` + `models/gta3.img`)
- `--tris` — QEM target triangles per LOD model (default `200`)
- `--tex` — LOD texture max size px (default `64`)
- `--draw` — LOD draw distance (default `300`)
- `--max` — cap on converted procobj objects (default `20000`, `0` disables)
- `--height` — optional min HD height (m) gate, drops short clutter (default `0` = off)

## What it does

Per `--dff ∩ procobj` species: build a model-local mesh (frame-aware), **QEM-decimate** it, re-derive smooth
normals, and encode a low-poly DFF. Then it reuses the engine's vanilla procobj scatter to place each species as
**static IPL instances** (HD instance → its LOD, thinned by MINDIST + a cap), strips those species from
`procobj.dat`, swaps their HD DFF for `--dff`, and packs a drop-in `gta3.img` + `data/` files. The LODs share one
`lod_procobj.txd` + `lod_procobj.col`, registered via `lod_procobj.ide` + a patched `gta.dat`.

[`UNDERWATER_PROCOBJ`](../map-placement/src/procobj-strip.ts) species (seaweed/starfish/searock) are **never**
converted.

## Architecture

A thin orchestrator over two shared packages (see [`docs/plans/001-architecture.md`](./docs/plans/001-architecture.md)):

- **[`@opensa/sa-lod`](../sa-lod/)** — the simplified-copy LOD pipeline (decimate → normals → encode DFF/TXD/COL),
  shared with [`lod-generator`](../lod-generator/).
- **[`@opensa/map-placement`](../map-placement/)** — SA map-edit workflows (procobj scatter → static IPL, id
  allocation, IDE/gta.dat edits, swapped-HD retexture), shared with `lod-trees-generator`.
