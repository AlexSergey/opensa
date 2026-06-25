/**
 * Game-agnostic types for the LOD generator. The world is bucketed into square **cells** (matching the engine's
 * streaming grid); each cell's HD instances are baked into one merged LOD mesh + atlas (plan 002). Kept
 * game-neutral so a future game plugs in via a {@link LodAdapter} without touching the core.
 */

/**
 * The baked output for one cell — a merged, decimated LOD mesh + its texture atlas + placement. The concrete
 * shape (geometry buffers, atlas raster, IPL entry) is defined as plan 002 lands its phases; for now the core
 * only needs the cell coordinate to drive `finalize`.
 */
export interface BakedCell {
  cx: number;
  cy: number;
  /** The cell's merged geometry (Phase 1). Decimation + atlas refine this in place as later phases land. */
  mesh: MergedMesh;
}

/** A square grid cell and the HD instances whose origin falls in it. */
export interface Cell {
  cx: number;
  cy: number;
  instances: CellInstance[];
}

/** One HD instance placed in the world (model + world transform), assigned to a cell. */
export interface CellInstance {
  model: string;
  position: Vec3;
  rotation: Quat;
}

/** Run configuration (the "what/where" knobs). */
export interface LodConfig {
  /**
   * Square cell size in world units. **Must equal the engine's streaming `cellSize`** so one baked LOD maps to
   * exactly one engine cell (see plan 002 "Engine fit").
   */
  cellSize: number;
  /** Far-view triangle budget per cell for QEM decimation (plan 002, 1c). */
  decimateTargetTriangles: number;
  /** Draw distance (world units) for emitted cell-LOD IDE defs — the original game's visibility gate. */
  lodDrawDistance: number;
  /** Max texture dimension (px) in a per-cell LOD TXD; sources are downscaled to it (plan 002, Phase 2). */
  lodTextureSize: number;
  /** Output directory; defaults to `lod-generator/out/<game>/`. */
  out?: string;
}

/** One texture's triangles within a {@link MergedMesh} — `indices` are triples into the vertex arrays. */
export interface MergedGroup {
  indices: Uint32Array;
  /** Base texture name (lowercased), or '' for untextured materials. */
  texture: string;
}

/**
 * A cell's HD instances merged into one mesh (Phase 1): cell-centre-relative, native Z-up world space, with
 * triangles bucketed into per-texture {@link MergedGroup}s (no atlas yet). Vertex attributes are parallel
 * arrays indexed by the group `indices`. Normals are carried from the source when present, else left zero for a
 * downstream normals pass; colours default to opaque white when a source vertex had no prelit.
 */
export interface MergedMesh {
  /** Prelit RGBA bytes, flattened (vertexCount × 4). */
  colors: Uint8Array;
  /** Per-texture triangle groups (vertex indices into the attribute arrays). */
  groups: MergedGroup[];
  /** Vertex normals, flattened (vertexCount × 3); zero where the source had none. */
  normals: Float32Array;
  /** Vertex positions, flattened (vertexCount × 3). */
  positions: Float32Array;
  /** UV layer 0, flattened (vertexCount × 2). */
  uvs: Float32Array;
}

export type Quat = readonly [number, number, number, number];

export type Vec3 = readonly [number, number, number];
