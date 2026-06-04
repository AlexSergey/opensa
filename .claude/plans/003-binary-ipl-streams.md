# Binary IPL streams — render full map geometry

## Context

The text IPLs referenced by `gta.dat` mostly contain **LOD** stand-ins plus a handful of objects —
that's why filtering LODs left only ~20 rendered instances. In GTA San Andreas the bulk of the
full-detail map placement lives in **binary IPL "stream" files** that ship *inside* the IMG archive
(`<iplname>_stream<N>.ipl`). The user extracted these to `static/stream_ipl/`. Parsing them and
resolving each placement's model **id** against the IDE catalog lets us draw the real map.

### Findings (verified)

- **Asset layout is correct.** `static/img/gta3/` holds the loose models (dff/txd); **no `.ipl`
  remain** inside it — all stream IPLs (180 files, incl. some unrelated `.ifp` animations) are in
  `static/stream_ipl/`. There is no stray `static/gta3`.
- **`gta.dat` now loads the full Los Santos set**: 9 IDEs (LAn/LAn2/LAs/LAs2/LAe/LAe2/LAw/LAw2/LAwn)
  → **2514** object defs, and 9 text IPLs.
- **Binary IPL format** (`bnry`):
  - Header: `char[4] "bnry"`, `u32 numInst` @0x04, … section counts …, `u32 instOffset` @0x1C (=76).
  - INST array at `instOffset`, **40 bytes each**: `pos` (3×f32, Z-up), `rotation` (4×f32 quaternion
    x,y,z,w), `modelId` (u32), `interior` (i32), `lod` (i32). **No model name** — id only.
- **Payoff**: across the 46 stream files matching the 9 gta.dat IPL basenames there are **10,417**
  INST entries; **1,208** resolve to a known def + present model file (all full-detail, non-LOD).
  ~20 → ~1,200 rendered objects. (The unresolved ~9k are generic props/vegetation defined in
  generic IDEs the user doesn't have — out of scope; they're simply skipped.)

## Where to reference the stream IPLs (the key question)

**Do not edit `gta.dat`.** Real SA never lists stream IPLs there — the engine finds them in the IMG
by name. We mirror that: each binary stream is associated with the **same-basename** text IPL already
in `gta.dat`. For every `IPL DATA\MAPS\LA\LAe.IPL`, derive basename `lae` and load
`static/stream_ipl/lae_stream0.ipl`, `…_stream1.ipl`, … (probe `N = 0,1,2…`, stop at the first 404).
A single new constant points at the stream folder (`${VITE_STATIC_URL}/stream_ipl`). This keeps the
existing DAT untouched and discovers all 46 files automatically.

## Architecture

```
src/gta-sa-parsers/
  binary-stream.ts            # tiny LE DataView reader (or reuse renderware/parser/binary-stream)
  ipl-binary.parser.ts        # parseBinaryIpl(ArrayBuffer) -> IplInstance[]  (modelName = '')
  index.ts                    # + export parseBinaryIpl
src/map/
  resolve-paths.ts            # + streamIplUrl(base, ipl basename, n)
  use-gta-map.ts              # after text IPLs, load matching binary streams, append instances
  map-scene.tsx               # LOD filter switches to def.modelName (binary insts have no name)
```

## Parser details

### `ipl-binary.parser.ts` → `IplInstance[]`
- Validate magic `bnry`; read `numInst` @0x04 and `instOffset` @0x1C; iterate `numInst` × 40-byte
  INST records. Emit the **existing** `IplInstance` shape so the walker is agnostic to source:
  `{ id, modelName: '', interior, position:[x,y,z], rotation:[x,y,z,w], lod }`.
  (`modelName` is empty because binary IPLs key by id; the walker already resolves model/txd names
  from the catalog `def`.)
- Reuse a little-endian DataView reader. The renderware `BinaryStream` already exists but lives in
  the renderware package; to keep `gta-sa-parsers` dependency-free, add a 20-line local reader (or
  read via a `DataView` directly). Prefer a local helper to avoid cross-package coupling.

## Walker integration

### `resolve-paths.ts`
- `streamIplUrl(streamBase, iplBasename, n)` → `${streamBase}/${iplBasename}_stream${n}.ipl`.
- `iplBasename(datPath)` → lowercased filename without extension (`DATA\MAPS\LA\LAe.IPL` → `lae`).

### `use-gta-map.ts`
- After parsing the text IPLs, for each IPL basename probe `n = 0,1,2,…`:
  `fetch(streamIplUrl(...))`; on `ok` → `parseBinaryIpl(arrayBuffer)` and push into `instances`;
  on 404 → stop that basename. `streamBase = ${base}/stream_ipl`.
- Keep everything in the single `MapDefinitions.instances` array; the catalog already resolves ids.
- This adds ~46 small fetches once, cached by the existing module promise cache.

### `map-scene.tsx`
- Resolve & filter using the **catalog def's** model name (binary instances carry none):
  `const def = catalog.get(instance.id); if (!def || isLodModel(def.modelName)) skip;`
  Pass `def` to `MapInstance` (already does). Keep the per-instance `<Suspense>`.
- `MapInstance` is unchanged (it already takes `def` + `instance`, loads txd+clump, positions+rotates).

### Coordinates
Unchanged: models load in native Z-up (`convertToYUp:false`), the map root applies the single −90°X,
binary positions/quaternions are in the same world space. `FitCamera` will now frame all of loaded LA.

## Performance note

~1,200 instances → ~1,200 meshes/draw calls. Unique models are far fewer (ids repeat heavily), and
`useClump`/`useLoader` dedupe fetches by url, but `buildClump` still runs per instance. Expected to
be playable for a static view; if it stutters, the follow-up is geometry instancing (`InstancedMesh`
per model) or merging — listed as out-of-scope below, not done now.

## Tests (vitest)

- `ipl-binary.parser.test.ts`: build a synthetic `bnry` buffer (header + a couple of 40-byte INST
  records) and assert exact decode (id, position, quaternion, interior, lod, `modelName===''`);
  reject non-`bnry` input. Real-asset integration (guarded by `existsSync`, lazy): parse
  `static/stream_ipl/lae_stream0.ipl` → `numInst === 319`, first INST `id === 620`,
  `position[0] ≈ 1971.8`.
- `resolve-paths.test.ts`: add `streamIplUrl` / `iplBasename` cases.

## Verification

1. `npm run lint` + `npx tsc --noEmit` clean; `npm test` green.
2. A node probe (already run) confirms 1,208 resolvable across the 9 LA basenames.
3. End-to-end: `npm run serve:static` + `npm run dev`, open the app → the full Los Santos blocks
   render (≫ the previous ~20), framed by FitCamera, no console errors. Playwright snapshot.

## Out of scope (extension points)

Real `.img`/`.dir` archive reading (we use the user's loose extraction), generic-IDE coverage for
the ~9k unresolved props/vegetation, `InstancedMesh`/geometry-merge performance pass, binary IDE,
interiors, the `lod` cross-reference linking, and zone/cull/path/garage sections of the binary IPL.
