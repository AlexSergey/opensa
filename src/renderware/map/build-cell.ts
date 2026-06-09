import type { Object3D } from 'three';

import type { ImgArchive } from '../archive';
import type { MapDefinitions } from '../parsers/text';
import type { GridCell, WorldGrid } from './world-grid';

import { buildCoronaPoints } from '../three/corona';
import { addToGroup, buildInstancedMeshes, collectCoronas, type RegionMeshData } from './build-region';
import { cellKey } from './world-grid';

/**
 * Build the renderable objects for one grid cell — its HD (`lod=false`) or LOD
 * (`lod=true`) instanced meshes (grouped by model, with `userData.region` for
 * picking), plus, for HD cells, a single `Points` glow cloud for any 2d-effect
 * coronas (street-lamp lights). Empty array if the cell isn't in the grid. The
 * streaming layer calls this per cell and caches the result.
 */
export function buildCell(
  archive: ImgArchive,
  defs: MapDefinitions,
  grid: WorldGrid,
  cx: number,
  cy: number,
  lod: boolean,
): Object3D[] {
  const cell = grid.get(cellKey(cx, cy));
  if (!cell) {
    return [];
  }
  const groups = [...cellGroups(defs, cell, lod).values()];
  const objects: Object3D[] = buildInstancedMeshes(archive, groups);
  // Coronas only on HD cells (LOD models carry no lights and the glow is a near-field effect). The ground
  // glow under lamps is the road's baked night vertex colours, not a projected pool.
  if (!lod) {
    const coronas = buildCoronaPoints(collectCoronas(archive, groups));
    if (coronas) {
      objects.push(coronas);
    }
  }

  return objects;
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
