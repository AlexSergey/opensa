# Plans index

The map of planning docs across the repo. **Engine plans** live here (`docs/plans/NNN-*.md`, numbered); the
**offline tools** keep their own `docs/plans/` next to their code. Open questions and parked ideas live in
[`../open-issues/`](../open-issues/) and [`../ideas/`](../ideas/).

> The [Nx monorepo migration (plan 057)](./057-nx-monorepo-migration.md) will move each tool's `docs/` under
> `tools/<name>/docs/` — update the links below when it lands.

## Engine (`docs/plans/`)

Core runtime + RenderWare parsing, world streaming, rendering, characters, vehicles, physics, UI — plans
`001`–`058`. Newest first:

- [058 — Modloader](./058-modloader.md) — `modloader/` overlay (`AssetFileSystem` decorator): override vehicle
  dff/txd + merge their settings into vehicles.ide/handling.cfg/carcols.dat, no engine changes.
- [057 — Nx monorepo migration](./057-nx-monorepo-migration.md)
- [056 — Multi-game config](./056-multi-game-config.md)
- [055 — Input sources / mobile controls](./055-input-sources-mobile-controls.md) · [054 — Asset cache revoke](./054-asset-cache-revoke.md) · [053 — Asset local loader](./053-asset-local-loader.md)
- …`001`–`052` in this folder.

## Tools (each ships its own plans)

- **map-optimizer** — lossless DFF/TXD conditioning (normals, prelit, dedupe, mips, full build).
  [`map-optimizer/docs/plans/`](../../tools/map-optimizer/docs/plans/) (`001`–`015`).
- **vehicle-optimizer** — scale + reflection-strength transfer for vehicle DFFs.
  [`vehicle-optimizer/docs/plans/`](../../tools/vehicle-optimizer/docs/plans/) (`001`–`003`).
- **lod-generator** — chunked LOD bake (merge → QEM decimate → per-cell TXD → drop-in build).
  [`lod-generator/docs/plans/`](../../tools/lod-generator/docs/plans/) (`001`–`002`).
- **lod-trees-generator** — SA-style tree LOD impostors (crossed-billboard cards + baked alpha atlas) from HD
  trees, plus the map strip + place stages (text↔binary IPL LOD-index coupling), the SA asset-format checklist,
  and aspect-aware atlas + `--prelight` trunk transfer. (procobj is now its own tool.)
  [`lod-trees-generator/docs/plans/`](../../tools/lod-trees-generator/docs/plans/) (`001`–`005`, `007`).
- **lod-procobj-generator** — procobj scatter → static IPL with **simplified-copy** (decimated) LODs; reuses
  `sa-lod` + `map-placement`. [`lod-procobj-generator/docs/plans/`](../../tools/lod-procobj-generator/docs/plans/) (`001`).
- **mod-installer** — layer mod folders onto a base game (files overwrite, `gta3img/` merges into `gta3.img`, a
  PNG folder merges into a sibling loose `.txd`), alphabetical.
  [`mod-installer/docs/plans/`](../../tools/mod-installer/docs/plans/) (`001` design · `002` as-built · `003` txd).
- **tool-kit** — shared building blocks (mesh smooth-normals + QEM simplify, editable IMG). No plans doc yet.
- **map-placement** — shared SA map-edit workflows (id allocation, IDE/gta.dat edits, swapped-HD retexture,
  procobj convert/strip), used by lod-trees-generator + lod-procobj-generator. No plans doc.
- **sa-lod** — shared simplified-copy LOD pipeline (decimate → normals → encode DFF/TXD/COL), extracted from
  lod-generator, used by it + lod-procobj-generator. No plans doc.
- **rw-codec** — shared pure RW chunk/DFF/DXT/geometry-struct codec, extracted from map-optimizer (plan 057,
  step 2). Top-level `rw-codec/` now; moves under `tools/` in the migration. No plans doc.
- **timecyc-builder** — timecyc precompute. No plans doc yet.

## Other docs

- [`../open-issues/`](../open-issues/) — investigated problems kept for reference (e.g. locked-dff).
- [`../ideas/`](../ideas/) — parked design directions ("later, maybe").
- [`../architecture.md`](../architecture.md) — high-level engine architecture.
