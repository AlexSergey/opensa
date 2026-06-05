import type { Object3D } from 'three';

import type { ModelColliders } from './collider.interface';

/** Request for one streamed grid cell's HD (`lod=false`) or LOD (`lod=true`) meshes. */
export interface CellRequest {
  cx: number;
  cy: number;
  lod: boolean;
}

export interface RegionRequest {
  center: Vec3;
  geometry: 'lods' | 'map';
  radius: number;
}

export type Vec3 = [number, number, number];

/**
 * The seam between the generic `game` engine and a concrete world implementation
 * (GTA SA / renderware). Implemented only under `game/adapters/**`; returns plain
 * three.js objects so the engine never names a `.dff`/`.txd`/IPL.
 */
export interface WorldAdapter {
  /** Edge length of a streaming grid cell, in world units. */
  readonly cellSize: number;
  /** Map a picked object + instance back to its source info. */
  describe(object: Object3D, instanceId?: number): null | WorldObjectInfo;
  /** Build one grid cell's meshes (native Z-up; the streaming root applies the −90°X). */
  loadCell(request: CellRequest): Promise<Object3D[]>;
  /** Build one grid cell's collision (its HD instances), for streaming the physics colliders. */
  loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]>;
  /** Build a debug wireframe overlay of the region's collision (empty if unsupported). */
  loadCollisionDebug(request: RegionRequest): Promise<Object3D[]>;
  /** Download/parse everything needed; reports progress 0..1. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
}

/** What a picked instance is (debug click-inspect). */
export interface WorldObjectInfo {
  modelName: string;
  position: Vec3;
  txdName: string;
}
