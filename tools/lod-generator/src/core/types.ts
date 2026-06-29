/**
 * Game-agnostic types for the LOD generator. The world is bucketed into square **cells** (matching the engine's
 * streaming grid); each cell's HD instances are baked into one merged LOD mesh + atlas (plan 002). Kept
 * game-neutral so a future game plugs in via a {@link LodAdapter} without touching the core. The merged-mesh types
 * live in the shared `@opensa/sa-lod` pipeline.
 */

import type { MergedMesh } from '@opensa/sa-lod/mesh';

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
  /** Floor on a cell's kept triangle count — a cell with fewer HD triangles than this is left undecimated. Sparse
   *  cells (e.g. open terrain / mountains) are already LOD-cheap; a flat ratio would over-thin them into holes. */
  lodCellMinTris: number;
  /** Fraction of a cell's merged triangles kept when decimating it as one welded mesh (the simplifier's group
   *  floor + edge cap keep every surface present and unspiked, so a small fraction still covers the cell). */
  lodCellRatio: number;
  /** Draw distance (world units) for emitted cell-LOD IDE defs — the original game's visibility gate. */
  lodDrawDistance: number;
  /** Max texture dimension (px) in a per-cell LOD TXD; sources are downscaled to it (plan 002, Phase 2). */
  lodTextureSize: number;
  /** Output directory for the baked drop-in (the CLI passes `--out <path>`). */
  out?: string;
}

export type Quat = readonly [number, number, number, number];

export type Vec3 = readonly [number, number, number];
