import type { InstancedMesh } from 'three';

import type { ImgArchive } from '../archive';
import type { MapDefinitions } from '../parsers/text';
import type { GridCell, WorldGrid } from './world-grid';

import { addToGroup, buildInstancedMeshes, type RegionMeshData } from './build-region';
import { cellKey } from './world-grid';

/**
 * Build the instanced meshes for one grid cell — its HD (`lod=false`) or LOD
 * (`lod=true`) instances, grouped by model with the same transforms /
 * `userData.region` as {@link buildRegion}. Empty array if the cell isn't in the
 * grid. The streaming layer calls this per cell and caches the result.
 */
export function buildCell(
  archive: ImgArchive,
  defs: MapDefinitions,
  grid: WorldGrid,
  cx: number,
  cy: number,
  lod: boolean,
): InstancedMesh[] {
  const cell = grid.get(cellKey(cx, cy));
  if (!cell) {
    return [];
  }

  return buildInstancedMeshes(archive, cellGroups(defs, cell, lod).values());
}

/** Group one cell's HD (`lod=false`) or LOD (`lod=true`) instances by model+txd. */
export function cellGroups(defs: MapDefinitions, cell: GridCell, lod: boolean): Map<string, RegionMeshData> {
  const groups = new Map<string, RegionMeshData>();
  for (const instance of lod ? cell.lod : cell.hd) {
    const def = defs.catalog.get(instance.id) ?? defs.timedCatalog?.get(instance.id);
    if (def) {
      addToGroup(groups, def, instance);
    }
  }

  return groups;
}
