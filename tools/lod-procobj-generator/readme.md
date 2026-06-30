# @opensa/lod-procobj-generator

Convert **GTA-SA procobj scatter species** (bushes, rocks, scrub, joshua…) into **static IPL instances with
simplified-copy LODs** — a decimated low-poly mesh, not a billboard impostor (that's
[`lod-trees-generator`](../lod-trees-generator/)). The companion to it for the procobj clutter the impostor tool
deliberately leaves alone.

```sh
tsx tools/lod-procobj-generator/src/cli.ts --out <path> --game <path> [--in <dir>]
```

- `--in` — optional folder of HD procobj models (`<model>.dff` + `<model>.txd`), intersected with `procobj.dat` to
  pick the species. **Omit it to convert every `procobj.dat` species straight from the game's own `gta3.img`** (no
  model/texture swap). With `--in`, LOD textures downscale from its TXDs, falling back to the stock game TXD.
- `--out` — output drop-in directory
- `--game` — game data (`gta.dat` + `data/` + `models/gta3.img`)
- `--tris` — QEM target triangles per LOD model (default `200`)
- `--tex` — LOD texture max size px (default `64`)
- `--draw` — LOD draw distance (default `300`)
- `--max` — cap on converted procobj objects (default `20000`, `0` disables)
- `--height` — optional min HD height (m) gate, drops short clutter (default `0` = off)
- `--prelight [info.json]` — copy each model's **stock** trunk prelight (day ambient) onto its decimated LOD mesh
  (and the swapped HD DFF when `--in`) so the simplified copy isn't black/washed-out next to stock geometry.
  Applied **trunk-only** (opaque surfaces; foliage — alpha-cutout — keeps its own prelit). Optionally pass a JSON
  of per-model overrides — `--prelight ./info.json` with `{ "cedar1_po": { "skip": true }, … }` opts those models
  **out** (LOD keeps its source prelit; HD packed verbatim). Bare `--prelight` applies to every model. Shared with
  `lod-trees-generator` via [`@opensa/sa-lod/prelight`](../sa-lod/src/prelight.ts).
- `--modloader` — emit **two** independent **Modloader mods** (real game) under `<out>`, so **no stock IDE is
  rewritten**:
  - **`<out>/lod/`** — the LODs: LOD DFFs + `lod_procobj.txd`/`.col` in `gta3img/` (injected into `gta3.img` by
    name; col auto-discovered), the new static IPL + stripped `procobj.dat` at their `data/` paths, and a
    `loader.txt` (`IDE` + `IPL`).
  - **`<out>/hd/`** — the swapped (prelit) `--in` procobj HD models + the custom TXD in `gta3img/`, plus a `txdp`
    IDE (`lod_procobj_hd.ide`) that **parents** each swapped model's stock TXD to the custom one — so the custom
    textures resolve without rewriting the stock IDE (the same approach as `lod-trees-generator`). Omitted with no
    `--in`.

  Without `--modloader`, repacks one `<out>/models/gta3.img` + patches `data/gta.dat` with the `--in` HD swap
  inlined. See [`docs/plans/004-modloader-output.md`](./docs/plans/004-modloader-output.md).

## What it does

Per converted species (every `procobj.dat` species, or the subset shipped in `--in`): build a model-local mesh
(frame-aware), **QEM-decimate** it, re-derive smooth normals, and encode a low-poly DFF. Then it reuses the engine's
vanilla procobj scatter to place each species as **static IPL instances** (HD instance → its LOD, thinned by MINDIST

- a cap), strips those species from `procobj.dat`, swaps their HD DFF for the `--in` model (only when `--in` is
  given), and packs a drop-in `gta3.img` + `data/` files. The LODs share one `lod_procobj.txd` + `lod_procobj.col`,
  registered via `lod_procobj.ide` + a patched `gta.dat`. The never-touch `UNDERWATER_PROCOBJ` species
  (seaweed/starfish/searock) are skipped.

A shared `--in` TXD is **trimmed** to just the textures the swapped procobj models use (via
`@opensa/map-placement/retxd`), so a vegetation pack's tree/non-procobj textures don't bloat the output.
`--prelight` optionally corrects the swapped HD + decimated LOD's trunk prelight from the stock model (see above).

[`UNDERWATER_PROCOBJ`](../map-placement/src/procobj-strip.ts) species (seaweed/starfish/searock) are **never**
converted.

## Architecture

A thin orchestrator over two shared packages. Plans: [`001` architecture](./docs/plans/001-architecture.md) ·
[`002` build pipeline](./docs/plans/002-build-pipeline.md) · [`003` SA asset format](./docs/plans/003-sa-asset-format.md).

- **[`@opensa/sa-lod`](../sa-lod/)** — the simplified-copy LOD pipeline (decimate → normals → encode DFF/TXD/COL),
  shared with [`opensa-lod-generator`](../opensa-lod-generator/).
- **[`@opensa/map-placement`](../map-placement/)** — SA map-edit workflows (procobj scatter → static IPL, id
  allocation, IDE/gta.dat edits, swapped-HD retexture), shared with `lod-trees-generator`.
