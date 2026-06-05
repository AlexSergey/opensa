import type { Object3D } from 'three';

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
  /** Map a picked object + instance back to its source info. */
  describe(object: Object3D, instanceId?: number): null | WorldObjectInfo;
  /** Build the renderable (instanced) objects for a region. */
  loadRegion(request: RegionRequest): Promise<Object3D[]>;
  /** Download/parse everything needed; reports progress 0..1. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
}

/** What a picked instance is (debug click-inspect). */
export interface WorldObjectInfo {
  modelName: string;
  position: Vec3;
  txdName: string;
}
