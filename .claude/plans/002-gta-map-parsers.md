# GTA map parsers (DAT / IDE / IPL) + scene walker

## Context

The RenderWare layer (`src/renderware/`) can already load a single `.dff` model with its
`.txd` textures. The next step is to render a **whole map scene** the way GTA San Andreas does:
a master `gta.dat` lists the asset archives and the IDE/IPL data files; the **IDE** files define
*what* objects exist (model + texture names, draw distance), and the **IPL** files define *where*
instances of those objects are placed (position + rotation). We parse this chain into in-memory
collections, then a **walker** iterates the IPL instances and draws each one with the existing
DFF/TXD loaders.

These text parsers are a different domain from the binary RenderWare reader, so they live in a
**new, separate** folder `src/gta-sa-parsers/` (pure, no three.js), exactly as requested.

### Verified file formats (from the real assets)

Map data currently lives under `static2/` (see "Asset location" below). Confirmed contents:

**`data/gta.dat`** — line-oriented, `#` comments, `DIRECTIVE  PATH` (Windows `\` separators):
```
IMG  IMG\basicmap                     # asset folder/archive
IDE  DATA\MAPS\basic\basicmap.IDE     # object definitions
IPL  DATA\MAPS\basic\basicmap.IPL     # scene placement
```
(Real game also uses COLFILE/TEXDICTION/MODELFILE/SPLASH/CDIMAGE… — out of scope; ignore unknown
directives.)

**`basicmap.ide`** — sections each terminated by `end`: `objs`, `tobj`, `path`, `2dfx`, `anim`,
`txdp`. Only `objs` is populated here:
```
objs
5000, gplane, basicmain, 300, 0          # id, model, txd, drawDist, flags
5404, testground, testground, 290, 0
end
```

**`basicmap.IPL`** — sections each terminated by `end`: `inst`, `cull`, `path`, `grge`, `enex`,
`pick`, `jump`, `tcyc`, `auzo`, `mult`. Only `inst` is populated:
```
inst
5000, gplane, 0, 0.0, -0.0778266, 23.9985, 0.0, 0.0, 0.0, 1.0, -1
# id, model, interior, posX, posY, posZ, rotX, rotY, rotZ, rotW(quat), lod
2964, K_POOLTABLESM, 0, -8.7174, -7.7539, 23.9191, 0, 0, 0, 1, -1
1340, CHILLIDOGCART, 0, -8.8324, 4.4257, 24.9789, 0, 0, 0, 1, -1
end
```

**Reality check for this dataset:** `img/basicmap/` contains loose files `gplane.dff`,
`testground.dff`, `basicmain.txd`, `testground.txd` (+ `.col` collision, ignored). So of the three
IPL instances, only **`gplane`** is both defined in the IDE *and* has model files present →
it renders (a ground plane at z≈24). `testground` is defined but never instanced;
`K_POOLTABLESM`/`CHILLIDOGCART` are instanced but have neither IDE def nor files → the walker must
**skip unresolved instances gracefully**.

## Architecture

```
src/gta-sa-parsers/            # pure text parsers, no three.js (unit-testable in node)
  types.ts                     # GtaDat, IdeObjectDef, IplInstance, MapDefinitions
  text-lines.ts                # shared helpers: strip #comments, split CSV row, tokenize
  gta-dat.parser.ts            # parseGtaDat(text) -> { img[], ide[], ipl[] }
  ide.parser.ts                # parseIde(text) -> IdeObjectDef[]  (objs/tobj)
  ipl.parser.ts                # parseIpl(text) -> IplInstance[]   (inst)
  index.ts                     # public exports

src/map/                       # R3F walker that ties parsers + renderware loaders to the scene
  resolve-paths.ts             # gta.dat \-> URL helpers (normalize \, lowercase, join base)
  use-gta-map.ts               # hook: fetch+parse dat -> ide+ipl -> { catalog, instances, imgBase }
  map-scene.tsx                # <MapScene datUrl> : renders each resolvable instance
  map-instance.tsx            # <MapInstance> : useLoader dff/txd, place at pos+quat
```

## Parser details (`src/gta-sa-parsers/`)

### `text-lines.ts` (shared)
- `cleanLines(text)`: split on newlines, trim, drop blanks and `#`-comments.
- `splitRow(line)`: split a CSV-ish row on commas, trim each cell (IDE/IPL use `, ` spacing).
- `sectionedParse(lines, { section: handler })`: generic state machine that walks the
  `name … end` block structure shared by IDE and IPL, dispatching rows to the active section's
  handler. Both `ide.parser` and `ipl.parser` reuse this.

### `gta-dat.parser.ts` → `GtaDat`
`parseGtaDat(text): { img: string[]; ide: string[]; ipl: string[] }`
- For each clean line, take the first whitespace token as the directive and the remainder as the
  path; collect `IMG`/`IDE`/`IPL` (case-insensitive), ignore everything else.
- Store **raw** paths; URL normalization happens in `src/map/resolve-paths.ts` (keeps the parser
  pure and renderer/host-agnostic).

### `ide.parser.ts` → `IdeObjectDef[]`
`parseIde(text): IdeObjectDef[]` using `sectionedParse`.
- `objs` (and `tobj`, same leading columns) row → `{ id, modelName, txdName, drawDistance, flags }`.
  Columns: `id, model, txd, drawDist, flags`. Parse defensively for the SA variant that inserts a
  mesh-count + multiple draw distances: first 3 cells are id/model/txd, the **last** is flags, the
  numeric cells between are draw distances (take the max). `tobj` adds time-on/off (captured but
  unused for now). Other sections are skipped.

### `ipl.parser.ts` → `IplInstance[]`
`parseIpl(text): IplInstance[]` using `sectionedParse`.
- `inst` row → `{ id, modelName, interior, position: [x,y,z], rotation: [x,y,z,w], lod }`
  (11 columns). Other sections skipped.

### `types.ts`
```ts
interface GtaDat { img: string[]; ide: string[]; ipl: string[]; }
interface IdeObjectDef { id: number; modelName: string; txdName: string; drawDistance: number; flags: number; }
interface IplInstance { id: number; modelName: string; interior: number;
  position: [number, number, number]; rotation: [number, number, number, number]; lod: number; }
interface MapDefinitions { catalog: Map<number, IdeObjectDef>; instances: IplInstance[]; imgDirs: string[]; }
```

## Map walker (`src/map/`, R3F)

### `resolve-paths.ts`
- `normalizeDatPath(p)`: `\`→`/`, collapse, **lowercase** (on-disk dirs/files are lowercase:
  `data/maps/...`, `img/basicmap/...`) so URLs work on case-sensitive HTTP servers.
- `datChildUrl(base, datPath)` and `imgAssetUrl(base, imgDir, name, ext)` → full fetch URLs.
  `base = import.meta.env.VITE_STATIC_URL` (the root that contains `data/` and `img/`).

### `use-gta-map.ts`
1. `fetch(datUrl)` → `parseGtaDat`.
2. `fetch` every `ide` path → `parseIde`, merge into a `catalog: Map<id, IdeObjectDef>`.
3. `fetch` every `ipl` path → `parseIpl`, concat into `instances`.
4. Filter to **renderable** instances: those whose `id` resolves in the catalog (gives the
   `txdName`). This naturally drops `K_POOLTABLESM`/`CHILLIDOGCART`. Returns `{ catalog, instances,
   imgBase }`. Uses `Suspense`-friendly caching (a small promise cache keyed by url, or `use()` /
   react-query-style memo) so it integrates with the existing `<Suspense>`.

### `map-instance.tsx`
- Props: `def: IdeObjectDef`, `instance: IplInstance`, `imgBase`.
- `useLoader(TXDLoader, imgAssetUrl(...,def.txdName,'txd'))` then
  `useLoader(DFFLoader, imgAssetUrl(...,def.modelName,'dff'), l => l.setTextures(textures))`.
  R3F's `useLoader` memoizes per (loader,url), so shared models/txds load once.
- Place the returned Group: `group.position.set(...instance.position)`,
  `group.quaternion.set(...instance.rotation)`.
- Each instance is wrapped in its own `<Suspense>` (+ optional error boundary) so a single missing
  asset can't blank the whole map.

### `map-scene.tsx`
- `const { catalog, instances, imgBase } = useGtaMap(datUrl)`.
- Renders the up-axis container + one `<MapInstance>` per filtered instance.

### Up-axis handling (small change to the RenderWare layer)
GTA world space is **Z-up**; three.js is Y-up. Today `buildClump` rotates *each* clump root −90°X,
which is right for the one-off model demo but wrong when positioning Z-up IPL coordinates. Plan:
- Add an option `buildClump(clump, textures?, { convertToYUp = true })` and a
  `DFFLoader.setConvertToYUp(boolean)` (default `true`, preserving current single-model behaviour).
- The map sets `convertToYUp = false` (models stay in native Z-up), places instances using raw
  Z-up position + quaternion, and the **`<MapScene>` root** applies the single −90°X. Everything
  stays in one coordinate space → consistent. (Note: SA's instance quaternion may need
  conjugation; verify visually with `gplane` and a rotated object, adjust in `map-instance` if so.)

## Asset location ⚠️ (decision needed at implementation time)

The task text says `static/data/gta.dat`, but the files currently live under **`static2/`**
(`static2/data/...`, `static2/img/basicmap/...`); `static/` holds the unrelated `bsor.*` demo.
`serve:static` serves `static/` and `VITE_STATIC_URL=http://localhost:3001`. Before wiring the
scene, the map assets must be reachable from the served root. Recommended: **consolidate the map
data into the served `static/` root** (so `static/data` + `static/img` exist) — or repoint
`serve:static`/`VITE_STATIC_URL` at `static2/`. The code stays root-relative either way.

## Tests (vitest, mirroring the existing renderware suite)

- `gta-dat.parser.test.ts`, `ide.parser.test.ts`, `ipl.parser.test.ts`: inline-string fixtures
  (deterministic, no files) covering comments/blank lines, every populated section, the unknown-
  directive/empty-section skips, and the IDE variable-column draw-distance case.
- `resolve-paths.test.ts`: backslash/lowercase normalization and URL joining.
- Integration: read the real `data/gta.dat`, `basicmap.ide`, `basicmap.IPL` (guarded by
  `existsSync`, lazy-read like the renderware integration specs) and assert: dat → 1 IMG/1 IDE/1
  IPL; IDE catalog has ids 5000 & 5404 with `txdName` `basicmain`/`testground`; IPL has 3 instances;
  exactly 1 (`gplane`) survives catalog filtering.

## Verification

1. `npm test` green (parsers + integration).
2. `npm run lint` clean — note `*.parser.ts` passes the kebab filename rule via
   `ignoreMiddleExtensions` (base `gta-dat` is kebab); folder `gta-sa-parsers` is kebab.
3. End-to-end: ensure map assets are under the served root, `npm run serve:static` +
   `npm run dev`, swap the demo `<Model>` in `src/app.tsx` for `<MapScene datUrl=".../data/gta.dat">`,
   open the app → the `gplane` ground plane renders (textured `basicmain`) at its IPL position;
   no console errors; unresolved instances are silently skipped. Confirm with a Playwright snapshot
   like the earlier model check.

## Out of scope (explicit extension points)

Real `.img`/`.dir` archive reading (currently loose files), `.col` collision, LOD linking (the
`lod` column / `lod*.ipl`), binary IPL/IDE, draw-distance culling, `tobj` time-of-day, interiors,
water/zones, and the other IDE/IPL sections. The parser data model and the parser→walker split are
designed so each is an additive change.
```
