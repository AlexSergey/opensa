# @opensa/lod-trees-generator

Generate **GTA-SA-style tree LOD impostors** (crossed-billboard cards + a baked alpha atlas) from HD tree models
— the cheap distant stand-in SA ships as `lod<Name>`.

```sh
tsx tools/lod-trees-generator/src/cli.ts --dff <path> --txd <path> --out <path> --game <path>
```

- `--dff` — HD tree DFF file or directory of them
- `--txd` — the HD models' own TXD (file or directory) — **textures are baked from here**
- `--out` — directory for the generated LOD DFFs + shared atlas TXD + COL
- `--game` — path to the game data (`gta3.img`); sources a structural LOD template only
- `--tex` / `--cards` — per-tree atlas size (px) / cards per tree (defaults in `config.ts`)

See [`docs/plans/002-build-pipeline.md`](./docs/plans/002-build-pipeline.md) for the design (and the
`cedar1_hi` → `lodCedar1_hi` reference breakdown). Per tree it bakes N crossed billboard cards from orthographic
views of the HD mesh into one `lod<Name>` atlas texture, then emits `lod<Name>.dff` + a shared `lodtrees.txd` +
`lodtrees.col`.
