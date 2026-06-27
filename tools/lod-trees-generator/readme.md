# @opensa/lod-trees-generator

Generate **GTA-SA-style tree LOD impostors** (crossed-billboard cards + a baked alpha atlas) from HD tree models
— the cheap distant stand-in SA ships as `lod<Name>`.

```sh
tsx tools/lod-trees-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path>
```

- `--dff` — HD tree DFF file or directory of them
- `--txd` — the HD models' own TXD (file or directory) — **textures are baked from here**
- `--out` — directory for the generated LOD DFFs + shared atlas TXD + COL (+ the stripped map)
- `--game` — path to the game data (`gta.dat` + `data/` + `models/gta3.img`)
- `--tex` / `--cards` — per-tree atlas size (px) / cards per tree (defaults in `config.ts`)
- `--draw` — impostor LOD draw distance in game units (default `1500`); how far the LOD stays visible
- `--prelight` — copy the stock model's prelight (day ambient) onto each swapped custom tree so it isn't
  black/washed-out next to stock geometry. Applied **trunk-only** (opaque surfaces; foliage keeps its own prelit)
  and to **both** the HD and the baked LOD atlas, so the impostor isn't over-bright vs the corrected HD
- `--loose` — write the modified IMG entries loose to `<out>/gta3img/` instead of repacking `gta3.img`
- `--strip` — verification mode: strip all source trees from the map (empty world) instead of placing LODs

With `--game` it also **places the impostors into the map** (stage 2): every streamed (binary IPL) placement of a
`--dff` model gets its impostor attached as its far-LOD — a leaf instance appended to the area's companion text
IPL (or an existing LOD row repointed), with the HD's `lod` linked to it. The impostors are registered
(`lodtrees.ide` + a patched `gta.dat`) and packed — along with the swapped HD DFFs (LOD'd, non-procobj models) —
into a drop-in repacked `gta3.img` (or loose `gta3img/`). `procobj.dat` is left untouched; procobj species get
their LODs from a separate tool (`lod-procobj-generator`) whose LODs are simplified-copy meshes, not impostors.

See [`docs/plans/002-build-pipeline.md`](./docs/plans/002-build-pipeline.md) for the bake design (and the
`cedar1_hi` → `lodCedar1_hi` reference breakdown), [`003-map-strip.md`](./docs/plans/003-map-strip.md) for the
text↔binary IPL **LOD-index coupling** (why a placement can't just be deleted — a binary stream's `lod` indexes
its companion text IPL, so the two share one index space), and [`004-map-place.md`](./docs/plans/004-map-place.md)
for the stage-2 placement. [`005-sa-asset-format.md`](./docs/plans/005-sa-asset-format.md) is the **must-read**
checklist of SA's strict DFF/TXD/COL/IDE requirements (tristrip flag, extra-vertex-colour, DXT5, 112-byte COL3,
id ≤ 18630) — each was a real "renders in the viewer, invisible/crashes in-game" bug.
[`007-impostor-improvements.md`](./docs/plans/007-impostor-improvements.md) covers the quality work: aspect-aware
(portrait) impostor textures for tall trees + the `--prelight` stock→custom prelight transfer.
