---
name: map-pipeline
description: GTA SA map loading pipeline (DAT/IDE/IPL parsers + R3F walker)
metadata:
  type: project
---

The map-loading layer renders a GTA San Andreas scene from its data files, built on top of the [[renderware-loader]].

**Parsers** — `src/gta-sa-parsers/` (pure, no three.js, kebab `*.parser.ts` names): `gta-dat.parser.ts` (`parseGtaDat` → `{ img, ide, ipl }` directive paths), `ide.parser.ts` (`parseIde` → object defs `id/model/txd/drawDistance/flags` from `objs`), `ipl.parser.ts` (`parseIpl` → text `inst` instances), `ipl-binary.parser.ts` (`parseBinaryIpl` → binary `bnry` stream IPLs: header magic `bnry`, `numInst`@0x04, `instOffset`@0x1C, 40-byte INST = pos 3f / quat 4f / **modelId** u32 / interior i32 / lod i32; `modelName=''`, resolved by id via catalog), `lod.ts` (`isLodModel` — SA LOD models are `lod`-prefixed). `text-lines.ts` has shared `sectionedParse`/`cleanLines`/`splitRow`. Types in `types.ts`.

**Walker** — `src/map/` (R3F): `resolve-paths.ts` (`datChildUrl`, `imgAssetUrl`, `iplBasename`, `streamIplUrl`), `use-gta-map.ts` (`useGtaMap`: fetch+parse dat→IDEs→catalog, text IPLs **plus** binary streams — for each text IPL it probes `ipl_binary/<base>_stream{N}.ipl` until 404 and appends `parseBinaryIpl` results; Suspense via `use()` + module cache), `use-clump.ts` (`useClump` — cached `parseDff` to a renderer-agnostic RWClump; avoids R3F's shared-mutable-`DFFLoader` texture race), `map-instance.tsx` (`useLoader(TXDLoader)` + `useClump`, builds per instance with `buildClump(clump, textures, { convertToYUp:false })` in `useMemo`, sets position/quaternion), `map-scene.tsx` (root `[-π/2,0,0]` Z-up→Y-up; filters to instances whose id is in the catalog AND `!isLodModel(def.modelName)`), `fit-camera.tsx` (auto-frames the scene bbox, refits as instances stream in — needed because GTA world coords are far from origin).

**Key design:** map keeps models in native Z-up via `DFFLoader.setConvertToYUp(false)` + `buildClump(..., { convertToYUp })` (default true preserves the single-model demo); the whole map group does the one −90°X. `src/app.tsx` renders `<MapScene base={BASE} datUrl={`${BASE}/data/gta.dat`}>`.

**Assets:** served from `static/` (`serve:static`, `VITE_STATIC_URL`). Real GTA SA Los Santos set: `static/data/gta.dat` (9 LA IDEs + 9 IPLs), `static/data/maps/LA/*.{ide,ipl}`, loose models in `static/img/gta3/` (~14.6k dff/txd, gta3.img extracted), and binary stream IPLs in `static/ipl_binary/` (`<region>_stream<N>.ipl`). Catalog ~2514 defs; binary streams add ~10k INST of which ~1.2k resolve (def+file) → ~1,200 full-detail objects render (vs ~20 from text IPLs alone). Plans: `.claude/plans/002-gta-map-parsers.md`, `003-binary-ipl-streams.md`. Extension points (out of scope): real `.img`/`.dir` archive reading (we use loose extraction), generic-IDE coverage for the ~9k unresolved props/vegetation, `InstancedMesh`/geometry-merge perf pass (~1.2k draw calls), `.col` collision, binary IDE, interiors.
