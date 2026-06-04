---
name: map-pipeline
description: GTA SA map loading pipeline (DAT/IDE/IPL parsers + R3F walker)
metadata:
  type: project
---

The map-loading layer renders a GTA San Andreas scene from its data files, built on top of the [[renderware-loader]].

**Parsers** — `src/gta-sa-parsers/` (pure text, no three.js, kebab `*.parser.ts` names): `gta-dat.parser.ts` (`parseGtaDat` → `{ img, ide, ipl }` directive paths), `ide.parser.ts` (`parseIde` → object defs `id/model/txd/drawDistance/flags` from `objs`), `ipl.parser.ts` (`parseIpl` → instances `id/model/interior/position[z-up]/rotation[quat xyzw]/lod` from `inst`). `text-lines.ts` has the shared `sectionedParse` (the `name…end` block state machine), `cleanLines`, `splitRow`. Types in `types.ts` (`GtaDat`, `IdeObjectDef`, `IplInstance`, `MapDefinitions`).

**Walker** — `src/map/` (R3F): `resolve-paths.ts` (normalize `\`→`/`, lowercase, join base URL; `datChildUrl`, `imgAssetUrl`), `use-gta-map.ts` (`useGtaMap` hook: fetch+parse dat→ide→ipl into `{ catalog, instances, imgDirs }`, Suspense via React 19 `use()` + module promise cache), `map-instance.tsx` (`useLoader` TXD+DFF, clones model, sets position/quaternion), `map-scene.tsx` (`<group rotation={[-π/2,0,0]}>` for Z-up→Y-up once; renders only instances whose id resolves in the catalog — undefined/missing ones skipped).

**Key design:** map keeps models in native Z-up via `DFFLoader.setConvertToYUp(false)` + `buildClump(..., { convertToYUp })` (default true preserves the single-model demo); the whole map group does the one −90°X. `src/app.tsx` renders `<MapScene base={BASE} datUrl={`${BASE}/data/gta.dat`}>`.

**Assets:** served from `static/` (`serve:static`, `VITE_STATIC_URL`): `static/data/gta.dat`, `static/data/maps/basic/basicmap.{ide,IPL}`, `static/img/basicmap/*.{dff,txd}`. (Old bsor demo moved to `static_old/`; parser unit fixtures in `tests/renderware/`.) For this dataset only `gplane` (id 5000) resolves+renders. Plan: `.claude/plans/002-gta-map-parsers.md`. Extension points: real `.img`/`.col`, LOD, binary IPL/IDE, draw-distance culling, IMG-archive reading (currently loose files).
