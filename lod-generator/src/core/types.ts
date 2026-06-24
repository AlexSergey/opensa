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
  /** Output directory; defaults to `lod-generator/out/<game>/`. */
  out?: string;
}

export type Quat = readonly [number, number, number, number];

export type Vec3 = readonly [number, number, number];
