# tool-kit

Shared building blocks for the offline tools (`map-optimizer`, `opensa-lod-generator`, `vehicle-optimizer`), decoupled
from any single tool so they don't reach into each other. Read-only over the engine's RenderWare primitives
(`../packages/renderware/src/...`); all mutation/convenience lives here.

Today a plain folder of relative-imported modules; on the eventual monorepo move it becomes a real package
(`@opensa/tool-kit`) — see [docs/ideas/monorepo-packages.md](../docs/ideas/monorepo-packages.md).

## Modules

- **`mesh/smooth-normals`** — smooth-group normal rebuild (map-optimizer plan 015), decoupled to operate on raw
  `positions` + flat triangle index-triples → `{ normals, indices, splitSources }`. Each caller re-expands its
  own attributes via `appendSplitsF32` / `appendSplitsU8`. Used by map-optimizer (SubMesh) + opensa-lod-generator
  (merged cell mesh).
- **`archive/img`** — an editable GTA IMG (VER2): `openImg(bytes)` / `editArchive(archive)` →
  open · get · set (add/replace) · delete · `build()` a fresh `.img`. Wraps the engine's `openArchive` +
  `buildVer2Buffer`. Used by map-optimizer (swap optimized entries) + opensa-lod-generator (emit the cell-LOD build).

## Principles

- **Never modify `../src`** — read-only reuse of the engine's parsers/writers; the toolkit adds the editing layer.
- **Tool-neutral** — no imports from `map-optimizer` / `opensa-lod-generator` / `vehicle-optimizer`; the dependency
  arrow points only inward (tools → tool-kit → engine).
