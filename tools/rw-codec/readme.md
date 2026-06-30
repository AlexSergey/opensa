# rw-codec

The **pure, byte-level RenderWare codec** shared by the offline tools — no dependency on any tool's IR (extracted
from map-optimizer so map-optimizer, opensa-lod-generator and vehicle-optimizer all consume one copy instead of
importing each other). A leaf: depends on nothing (its tests read engine fixtures, but the source is standalone).

On the Nx monorepo move it becomes `@opensa/rw-codec` (`tools/rw-codec`) — see
[docs/plans/057](../docs/plans/057-nx-monorepo-migration.md).

## Modules (`rw-codec/src/`)

- **`chunk`** — faithful RW chunk tree read/write (`readRw` / `writeRw`, `RwChunk`, `RW_*` section ids).
- **`geometry-struct`** — RpGeometry Struct decode ⇄ encode (`decodeGeometryStruct` / `encodeGeometryStruct`,
  `GeometryStruct`); byte-exact round-trip.
- **`dff`** — `collectGeometries` / `collectGeometryStructs` (walk a clump's geometry list).
- **`dxt`** / **`dxt-encode`** — DXT1/3/5 decode ⇄ encode (RGBA ⇄ BCn).
- **`texture-native`** — TextureNative Struct encoders (`encodeRgba8888Struct`, `encodeSameFormatStruct`).
- **`mip`** — RGBA mip-chain box downsampling (`buildMipChain`, `downsample`).

The map-optimizer-specific glue that maps its `SubMesh`/`MeshIR` onto these (`encodeDff`, `applyMeshToStruct`,
`rebuildGeometry`) stays in **map-optimizer** and imports this codec.
