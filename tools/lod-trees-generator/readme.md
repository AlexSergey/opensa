# @opensa/lod-trees-generator

Generate **GTA-SA-style tree LOD impostors** (crossed-billboard cards + a baked alpha atlas) from HD tree models
— the cheap distant stand-in SA ships as `lod<Name>`.

```sh
tsx tools/lod-trees-generator/src/cli.ts --out <path> --game <path> [--in <dir>]
```

- `--in` — optional folder of HD trees (`<model>.dff` + `<model>.txd`); textures are baked from its TXDs. A
  **directory** is filtered to tree-like models — `procobj.dat` scatter species (handled by
  `lod-procobj-generator`) and non-foliage "types" (rocks / grass / flowers / rubble / pots / proc-patches /
  already-`lod*`) are skipped (logged); a single-file `--in` is taken as-is. **Omit `--in` to bake the built-in SA
  tree roster (`@opensa/map-placement/vegetation`) straight from the game's own `gta3.img`** — no model/texture
  swap, just impostor LODs for the stock trees. (SA has no "is-a-tree" data flag, so the roster + the "type" cut
  are curated — review/extend `map-placement/src/vegetation.ts` for a given game.)
- `--out` — drop-in output: **`gta3.img`** (repacked) holding the LOD DFFs + atlas TXD + COL + swapped HD + edited
  streams, and **`data/`** with the patched `gta.dat`/IPLs/IDEs. The per-impostor DFFs + `lodtrees.txd`/`.col` are
  packed into the IMG and their redundant root copies removed, so the root is left clean (only `gta3.img` +
  `data/`). Per-impostor PNG previews are written only with `--debug-png`.
- `--game` — path to the game data (`gta.dat` + `data/` + `models/gta3.img`)
- `--tex` / `--cards` — per-tree atlas size (px) / cards per tree (defaults in `config.ts`)
- `--draw` — impostor LOD draw distance in game units (default `1500`); how far the LOD stays visible
- `--prelight [info.json]` — copy the stock model's prelight (day ambient) onto each swapped custom tree so it
  isn't black/washed-out next to stock geometry. Applied **trunk-only** (opaque surfaces; foliage keeps its own
  prelit) and to **both** the HD and the baked LOD atlas, so the impostor isn't over-bright vs the corrected HD.
  Optionally pass a JSON of per-model overrides — `--prelight ./info.json` with
  `{ "tree_hipoly09b": { "skip": true }, … }` opts those models **out** of the transfer (HD packed verbatim, LOD
  baked from its own prelit). Bare `--prelight` applies to every model.
- `--modloader` — emit **two** independent **Modloader mods** (real game) under `<out>` instead of repacking
  `gta3.img`, so **no stock IDE is ever rewritten**:
  - **`<out>/lod/`** — the LOD attachment, the **same far-LOD link** as `--out` (impostors linked as the stock
    trees' LODs — no near-field doubling), packaged like the MixMods "LOD Vegetation" mod: modified **text IPLs**
    as loose overrides under `data/maps/...` (only the areas touched), modified **binary streams** + impostor DFFs
    - `lodtrees.txd`/`.col` in `gta3img/` (injected into `gta3.img` by name; col auto-discovered), `lodtrees.ide`
      via a one-line `loader.txt`.
  - **`<out>/hd/`** — the swapped (prelit) `--in` HD models + the custom TXD in `gta3img/`, plus a `txdp` IDE
    (`lodtrees_hd.ide`) that **parents** each swapped model's stock TXD to the custom one — so the custom textures
    resolve without rewriting the stock IDE (the BSOR Vegetation approach; OpenSA's engine resolves `txdp`
    too). Omitted when there's no `--in`.

  See `docs/plans/008-modloader-output.md`.

- `--strip` — verification mode: strip all source trees from the map (empty world) instead of placing LODs
- `--debug-png` — also write a per-impostor PNG preview of each baked card atlas to `<out>` (default off)

With `--game` it also **places the impostors into the map** (stage 2): every streamed (binary IPL) placement of a
source model gets its impostor attached as its far-LOD — a leaf instance appended to the area's companion text IPL
(or an existing LOD row repointed), with the HD's `lod` linked to it. By default (`--out`) this is registered
(`lodtrees.ide` + a patched `gta.dat`) and packed, along with the swapped HD DFFs (LOD'd, non-procobj models), into
a repacked `gta3.img`. With **`--modloader`** the _same_ attachment is split into two mods — `<out>/lod/` (the LOD
attachment) + `<out>/hd/` (the swapped HD models via a `txdp` IDE) — neither touching a stock IDE (see the
`--modloader` flag above). A shared `--in`
TXD is **trimmed** to just the textures the swapped models use (the dropped procobj/non-tree models' textures don't
bloat the output). `procobj.dat` is left untouched; procobj species get their LODs from a separate tool
(`lod-procobj-generator`) whose LODs are simplified-copy meshes, not impostors.

See [`docs/plans/002-build-pipeline.md`](./docs/plans/002-build-pipeline.md) for the bake design (and the
`cedar1_hi` → `lodCedar1_hi` reference breakdown), [`003-map-strip.md`](./docs/plans/003-map-strip.md) for the
text↔binary IPL **LOD-index coupling** (why a placement can't just be deleted — a binary stream's `lod` indexes
its companion text IPL, so the two share one index space), and [`004-map-place.md`](./docs/plans/004-map-place.md)
for the stage-2 placement. [`005-sa-asset-format.md`](./docs/plans/005-sa-asset-format.md) is the **must-read**
checklist of SA's strict DFF/TXD/COL/IDE requirements (tristrip flag, extra-vertex-colour, DXT5, 112-byte COL3,
id ≤ 18630) — each was a real "renders in the viewer, invisible/crashes in-game" bug.
[`007-impostor-improvements.md`](./docs/plans/007-impostor-improvements.md) covers the quality work: aspect-aware
(portrait) impostor textures for tall trees + the `--prelight` stock→custom prelight transfer.
