import type { Object3D } from 'three';

import type { ImgArchive } from '../archive';
import type { MapDefinitions } from '../parsers/text';
import type { GridCell, WorldGrid } from './world-grid';

import { buildParticleEmitters } from '../three/build-particles';
import { buildCoronaPoints } from '../three/corona';
import {
  addToGroup,
  buildAnimatedObjects,
  buildEscalatorMeshes,
  buildInstancedMeshes,
  type BuildRegionOptions,
  buildRoadsignMeshes,
  collectBreakables,
  collectCoronas,
  collectParticleEmitters,
  type RegionMeshData,
} from './build-region';
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
  options: BuildRegionOptions = {},
): Object3D[] {
  const cell = grid.get(cellKey(cx, cy));
  if (!cell) {
    return [];
  }
  const groups = [...cellGroups(defs, cell, lod).values()];
  const instancedMeshes = buildInstancedMeshes(archive, groups, options);
  const objects: Object3D[] = [...instancedMeshes];
  // Breakable props (plan 045): register the cell's smashable instances (HD only — props are
  // near-field and have no LOD collision/break). Registration is keyed by placement, so the cached
  // cell rebuild replaces stale entries rather than duplicating them.
  if (!lod) {
    collectBreakables(archive, instancedMeshes, options.breakableModels);
  }
  // IDE anim objects (plan 041): per-instance frame hierarchies with a looping IFP clip —
  // animation mutates node transforms, so they can't ride the InstancedMesh path above.
  objects.push(...buildAnimatedObjects(archive, groups));
  // Road-sign text (plan 042 item 5): world-space glyph quads, HD cells only (near-field text).
  if (!lod) {
    objects.push(...buildRoadsignMeshes(archive, groups));
    // 2dfx particle emitters (plan 044): fires, fountains, smoke — near-field, HD cells only.
    objects.push(...buildParticleEmitters(collectParticleEmitters(archive, groups)));
    // 2dfx escalators (plan 044): moving step rows instanced from the vanilla esc_step model.
    objects.push(...buildEscalatorMeshes(archive, defs, groups));
  }
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
