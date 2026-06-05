import type { WorldGrid } from '../map/world-grid';
import type { IplInstance, MapDefinitions } from '../parsers/text';
import type { RegionColliders } from './build-colliders';
import type { CollisionIndex } from './collision-index';

import { cellKey } from '../map/world-grid';
import { bindColliders, groupInstanceByModel } from './build-colliders';

/**
 * Bind collision for one grid cell's HD instances (LODs have no collision), grouped
 * by model and looked up in the index — the per-cell counterpart of
 * {@link buildColliders}, for collision streaming. Empty array if the cell isn't in
 * the grid. Transforms are GTA Z-up (conjugated IPL quaternion), like the render.
 */
export function buildCellColliders(
  index: CollisionIndex,
  defs: MapDefinitions,
  grid: WorldGrid,
  cx: number,
  cy: number,
): RegionColliders[] {
  const cell = grid.get(cellKey(cx, cy));
  if (!cell) {
    return [];
  }
  const groups = new Map<string, IplInstance[]>();
  for (const instance of cell.hd) {
    const def = defs.catalog.get(instance.id);
    if (def) {
      groupInstanceByModel(groups, def.modelName, instance);
    }
  }

  return bindColliders(index, groups);
}
