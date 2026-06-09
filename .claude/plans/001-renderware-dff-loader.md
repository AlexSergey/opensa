# RenderWare DFF + TXD Loader (GTA San Andreas)

## Context

The project currently renders a generated `.3ds` cube via three.js / R3F. The goal is to
load **real GTA San Andreas assets** in RenderWare format: a model (`.dff`) and its texture
dictionary (`.txd`). Two test files are in `static/`:

- `bsor_cedar1_hi.dff` (21 KB) — a single textured mesh ("Cedar1_hi")
- `bsor.txd` (49 MB) — DXT-compressed texture dictionary

This first pass delivers a **working textured render** of `bsor_cedar1_hi.dff`, but the code is
deliberately **layered** so later work (skinning, collisions, multiple atomics, LOD, streaming)
slots in without rewrites. Verified facts from decoding the actual files:

- DFF chunk tree is canonical RW: `Clump → FrameList → GeometryList → Geometry → MaterialList`,
  plus `BinMeshPLG` material-split data and a final `Atomic` linking frame ↔ geometry.
- Geometry: **476 vertices, 176 triangles, 2 UV layers, prelit vertex colors, NO stored normals**
  (flags `0xAA`) → normals must be computed.
- TXD textures are **DXT1** (Texture Native chunks, raw DXT mip blocks, name-keyed).
- Standard RW chunk header is 12 bytes: `[type:u32][size:u32][libraryVersion:u32]`, little-endian.

## Architecture

Renderer-agnostic binary parser → plain data model → thin three.js adapter → R3F loaders.

```
src/renderware/
  parser/
    binary-stream.ts   # DataView cursor: LE int/float/string reads, bounds-checked
    chunks.ts          # chunk-header read, RW type constants, findChild/forEachChild walkers
    constants.ts       # geometry flags, raster formats, platform/D3D format enums
    types.ts           # data model: RWClump, RWFrame, RWGeometry, RWMaterial,
                       #             RWTextureDictionary, RWTexture (+ raster bytes/format)
    dff.ts             # parseDff(ArrayBuffer) -> RWClump
    txd.ts             # parseTxd(ArrayBuffer) -> RWTextureDictionary
  three/
    build-texture.ts   # RWTexture -> THREE.CompressedTexture (DXT) | DataTexture (uncompressed)
    build-clump.ts     # RWClump (+ optional texture map) -> THREE.Group
    DFFLoader.ts       # THREE.Loader subclass -> Group; .setTextures(map) injects TXD
    TXDLoader.ts       # THREE.Loader subclass -> Map<string, THREE.Texture>
  index.ts             # public exports
```

**Why layered:** `parser/*` has zero three.js imports → unit-testable in Node, reusable for
collision/streaming later. `three/*` is the only three-coupled layer. The data model (`types.ts`)
is the stable seam everything extends against.

## Parser details

### `binary-stream.ts`
Small class over `DataView` + offset: `u8/u16/u32/i32/f32`, `string(len)` (NUL-trimmed),
`skip`, `seek`, `remaining`. All little-endian. This removes manual offset arithmetic from the
parsers and is the single place to add bounds checks.

### `chunks.ts`
- `readChunkHeader(stream) -> { type, size, version, dataStart, end }`.
- Type constants: `STRUCT 0x01, STRING 0x02, EXTENSION 0x03, TEXTURE 0x06, MATERIAL 0x07,
  MATLIST 0x08, FRAMELIST 0x0E, GEOMETRY 0x0F, CLUMP 0x10, ATOMIC 0x14, TEXNATIVE 0x15,
  TEXDICT 0x16, GEOMETRYLIST 0x1A, BINMESHPLG 0x50E`.
- `findChild(stream, end, type)` and `forEachChild(stream, end, cb)` to iterate sibling chunks
  by walking `dataStart..end`. This is the core traversal reused by both `dff.ts` and `txd.ts`.

### `dff.ts` → `RWClump`
Walk `Clump`:
1. **FrameList**: Struct = `numFrames`, then per frame `{ rotation: 3×3, position: vec3,
   parentIndex: i32, flags }`. Frame names come from each frame's `Extension` (chunk `0x253F2FE`).
2. **GeometryList**: Struct = `numGeometries`, then each **Geometry**:
   - Struct header: `flags:u16, numUVLayers:u8, native:u8, numTriangles, numVertices, numMorph`.
   - If `prelit` flag → `numVertices × RGBA` byte colors.
   - `numUVLayers × numVertices × vec2` UVs.
   - `numTriangles × { v2:u16, v1:u16, materialIndex:u16, v3:u16 }`.
   - Morph target: bounding sphere `vec4`, `hasVertices:u32`, `hasNormals:u32`, then positions
     (`vec3×n`), then normals if present (this file has none → compute later).
   - **MaterialList**: Struct = `numMaterials` + index table; each **Material** has color RGBA,
     `textured` flag, and a **Texture** (`0x06`) child whose String children give the diffuse
     texture name (+ optional mask name). Store the name; resolution against the TXD happens in
     the adapter.
3. **Atomic**: Struct links `frameIndex` ↔ `geometryIndex`.

`BinMeshPLG` (material split / tristrip vs trilist) is **read but not required** for this pass —
triangles already carry `materialIndex`, so the adapter groups by it. Parsing the split is left as
a noted extension point (needed later for correct tristrip handling).

### `txd.ts` → `RWTextureDictionary`
Walk `TexDict`: Struct = `textureCount` (+ device id). For each **TextureNative**:
- Struct: `platform:u32, filterFlags:u16, name:char[32], maskName:char[32], rasterFormat:u32,
  d3dFormat (or hasAlpha), width:u16, height:u16, depth:u8, numLevels:u8, rasterType:u8,
  compression:u8`.
- Then per mip level: `size:u32` + raw bytes.
- Record `{ name, width, height, format, mipmaps: [{width,height,data}] }`. Decode of the format
  byte → one of `DXT1 / DXT3 / DXT5 / RGBA8888 / palettized`. **This pass implements DXT1/3/5 and
  uncompressed 32-bit**; palettized (8-bit + palette) is a stubbed branch that throws a clear
  "unsupported raster format" error (extension point).

## three.js adapter

### `build-texture.ts`
- DXT formats → `THREE.CompressedTexture(mipmaps, w, h, RGBA_S3TC_DXTn_Format)` — RW stores raw DXT
  blocks, so **no re-encode** needed; feed blocks straight in. Set `needsUpdate`, flipY=false,
  sensible wrap/filter from RW filter flags.
- Uncompressed 32-bit → `THREE.DataTexture` (swizzle BGRA→RGBA).
- Returns a `Map<string (lowercased name), THREE.Texture>` from the whole dictionary.

### `build-clump.ts`
`buildClump(clump, textures?) -> THREE.Group`:
- For each Atomic → its Geometry → one `THREE.BufferGeometry`:
  - `position` (Float32), `color` (from prelit RGBA, normalized) if present, `uv` (layer 0), index.
  - `geometry.computeVertexNormals()` when normals absent.
  - Group triangles by `materialIndex` → `geometry.addGroup(...)` per material; build a parallel
    materials array. Each material → `MeshStandardMaterial` (or `MeshBasicMaterial` if you prefer
    the baked look) with `map = textures.get(name)`, `vertexColors: true` when prelit present,
    `transparent` from alpha.
  - Apply the frame's local transform (rotation matrix + position) to the `THREE.Mesh`.
- Returns the assembled Group.

### `DFFLoader.ts` / `TXDLoader.ts`
Both extend `THREE.Loader` for drop-in `useLoader` use (matching the existing cube/`TDSLoader`
pattern in `src/App.tsx`):
- `TXDLoader.load(url, onLoad)` → fetch ArrayBuffer → `parseTxd` → `build-texture` map.
- `DFFLoader` has `setTextures(map)`; `load(url, onLoad)` → fetch → `parseDff` → `buildClump(clump,
  this.textures)`.

## R3F wiring (`src/App.tsx`)

Replace the cube with the model. `useLoader`'s third "extensions" callback injects textures into
the DFF loader before it runs:

```tsx
const textures = useLoader(TXDLoader, `${BASE}/bsor.txd`);
const model = useLoader(DFFLoader, `${BASE}/bsor_cedar1_hi.dff`,
  (loader) => loader.setTextures(textures));
return <primitive object={model} />;
```

Keep `OrbitControls`, lights, and `Suspense`. `BASE = import.meta.env.VITE_STATIC_URL`.
Note: the 49 MB TXD download is fine for local dev; lazy/streamed TXD is a future optimization.

## Files to create / change

- **New:** the `src/renderware/**` tree above.
- **Change:** `src/App.tsx` — swap `TDSLoader` cube for `TXDLoader` + `DFFLoader` model.
- No new runtime deps (uses existing `three`); `@types/three` already present.

## Verification

1. **Parser sanity (Node, no DOM):** a throwaway `node -e` script that calls `parseDff` on
   `bsor_cedar1_hi.dff` and asserts `476 vertices, 176 triangles, 1 material, texture name present`;
   and `parseTxd` on `bsor.txd` asserts `textureCount > 0` and first texture is DXT1. (These exact
   numbers were confirmed by decoding the files.)
2. **Type check:** `npx tsc --noEmit` clean.
3. **End-to-end:** `npm run serve:static` + `npm run dev`, open `http://localhost:5173` — the
   Cedar1 model renders **textured** and orbits under mouse control. Confirm no WebGL/console errors
   (esp. compressed-texture format support).

## Out of scope (explicit extension points)

Skinning (`SkinPLG`), multi-atomic clumps, frame hierarchy parenting, tristrip via `BinMeshPLG`,
palettized/PAL8 rasters, COL collision, IMG/IDE/IPL world streaming. The data model and the
parser/adapter split are designed so each is an additive change, not a rewrite.

**Since-added geometry plugins** (additive, as designed): 2d-effect lights `0x253F2F8` (`geometry.lights`,
plan 032 coronas), and **night vertex colours `0x253F2F9`** (`geometry.nightColors` — SA's second/night prelit
set; bright window texels glow at night, see plan [[032-night-and-lights]] phase 10).

---
*Requested filename: `.claude/plans/001-renderware-dff-loader.md`. Plan mode wrote this to the
global plans dir; on approval I'll also copy it to the project-local `.claude/plans/` path.*
