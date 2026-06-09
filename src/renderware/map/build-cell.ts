import type { Object3D } from 'three';

import type { ImgArchive } from '../archive';
import type { MapDefinitions } from '../parsers/text';
import type { GridCell, WorldGrid } from './world-grid';

import { buildCoronaPoints } from '../three/corona';
import { buildLightPools } from '../three/light-pool';
import { addToGroup, buildInstancedMeshes, collectLights, type RegionMeshData } from './build-region';
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
  // Night lights only on HD cells (LOD models carry no lights and the glow is a near-field effect):
  // a corona glow at each bulb + a flat light pool splat on the ground under it.
  if (!lod) {
    const { coronas, pools } = collectLights(archive, groups);
    const coronaPoints = buildCoronaPoints(coronas);
    const lightPools = buildLightPools(pools);
    if (coronaPoints) {
      objects.push(coronaPoints);
    }
    if (lightPools) {
      objects.push(lightPools);
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
