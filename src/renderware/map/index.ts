// Framework-agnostic GTA map resolution + streamed cell instancing.
export { buildCell } from './build-cell';
export { buildProcObjMeshes } from './build-procobj';
export { type RegionMeshData } from './build-region';
export { type ProcObjCategoryName, procObjCategory } from './procobj-categories';
export { type ProcObjColliderOptions, procObjColliders } from './procobj-colliders';
export { type ProcObjSettings, resetProcObjMeshes, updateProcObjMeshes } from './procobj-runtime';
export {
  groupRulesBySurface,
  PROC_OBJ_MAX_DENSITY,
  type ProcObjBatch,
  procObjLotteryCap,
  type ProcObjPlacement,
  scatterProcObjects,
} from './procobj-scatter';
export { resolveMap, type ResolveMapOptions } from './resolve-map';
export { buildWorldGrid, cellKey, type GridCell, instanceCell, type WorldGrid } from './world-grid';
