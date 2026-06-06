import type { AnimationClip, Bone, Object3D, Skeleton } from 'three';

import type { CellCoord } from '../streaming/grid';
import type { VehicleRig } from '../vehicle/vehicle-rig';
import type { ModelColliders } from './collider.interface';

/** Request for one streamed grid cell's HD (`lod=false`) or LOD (`lod=true`) meshes. */
export interface CellRequest {
  cx: number;
  cy: number;
  lod: boolean;
}

/** A loaded character: the renderable plus its skeleton (null if the model isn't skinned). */
export interface CharacterModel {
  /** Bones keyed by name, for the animation manager. */
  bonesByName: Map<string, Bone>;
  object: Object3D;
  skeleton: null | Skeleton;
}

export interface RegionRequest {
  center: Vec3;
  geometry: 'lods' | 'map';
  radius: number;
}

export type Vec3 = [number, number, number];

/** A loaded vehicle: the renderable, its model-space collision, and its wheel rig. */
export interface VehicleModel {
  /** Collision in model space (`transforms` empty — the caller sets the placement). */
  colliders: ModelColliders | null;
  object: Object3D;
  /** Animatable wheels (spin/steer); register with the vehicle system. */
  rig: VehicleRig;
}

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
  /** Every grid cell that holds content (for the debug section inspector). */
  listCells(): CellCoord[];
  /** Load one IFP from a packed WIMG animation archive into clips keyed by lowercased name. */
  loadAnimations(archiveUrl: string, ifpName: string): Promise<Map<string, AnimationClip>>;
  /** Build one grid cell's meshes (native Z-up; the streaming root applies the −90°X). */
  loadCell(request: CellRequest): Promise<Object3D[]>;
  /** Build one grid cell's collision (its HD instances), for streaming the physics colliders. */
  loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]>;
  /** Load a character model (DFF + TXD) into a renderable object (native GTA Z-up). */
  loadCharacter(dffUrl: string, txdUrl: string): Promise<CharacterModel>;
  /** Build a debug wireframe overlay of the region's collision (empty if unsupported). */
  loadCollisionDebug(request: RegionRequest): Promise<Object3D[]>;
  /** Load a painted, wheeled vehicle by model name (native Z-up; place under the streaming root). */
  loadVehicle(modelName: string): Promise<VehicleModel>;
  /** Build the flat water surface from `water.dat`, textured from the given TXD (native Z-up). */
  loadWater(waterUrl: string, txdUrl: string): Promise<Object3D>;
  /** Download/parse everything needed; reports progress 0..1. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
}

/** What a picked instance is (debug click-inspect). */
export interface WorldObjectInfo {
  modelName: string;
  position: Vec3;
  txdName: string;
}
