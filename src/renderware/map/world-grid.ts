import type { IplInstance, MapDefinitions } from '../parsers/text';

import { isInterior, isLodModel } from '../parsers/text';

/** One grid cell's placed instances, split into full-detail (HD) and LOD. */
export interface GridCell {
  cx: number;
  cy: number;
  hd: IplInstance[];
  lod: IplInstance[];
}

/** Exterior instances bucketed into square cells, keyed by `cellKey`. */
export type WorldGrid = Map<string, GridCell>;

/**
 * Bucket the map's exterior instances into a square grid of the given cell size,
 * splitting each cell into HD (full-detail) and LOD (`lod`-prefixed models) lists.
 * Instances with no catalog def are skipped (they can't be rendered). Exterior vs
 * interior is decided by {@link isInterior} — the real interior id is the low byte
 * of the IPL `interior` field (`value & 0xFF`), so `interior === 0` was too strict
 * (it dropped exterior objects whose area code is a multiple of 256). Pure data —
 * the streaming layer turns cells into meshes.
 */
export function buildWorldGrid(defs: MapDefinitions, cellSize: number): WorldGrid {
  const grid: WorldGrid = new Map();
  for (const instance of defs.instances) {
    const def = defs.catalog.get(instance.id);
    if (!def || isInterior(instance.interior)) {
      continue;
    }
    const [cx, cy] = instanceCell(instance.position, cellSize);
    const key = cellKey(cx, cy);
    let cell = grid.get(key);
    if (!cell) {
      cell = { cx, cy, hd: [], lod: [] };
      grid.set(key, cell);
    }
    (isLodModel(def.modelName) ? cell.lod : cell.hd).push(instance);
  }

  return grid;
}

/** Stable string key for a cell coordinate. */
export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** The grid cell a position falls in (X/Y plane; Z ignored). */
export function instanceCell(position: readonly [number, number, number], cellSize: number): [number, number] {
  return [Math.floor(position[0] / cellSize), Math.floor(position[1] / cellSize)];
}
