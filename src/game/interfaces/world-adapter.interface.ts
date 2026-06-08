import type { AnimationClip, Bone, Matrix4, MeshStandardMaterial, Object3D, Skeleton } from 'three';

import type { CellCoord } from '../streaming/grid';
import type { VehicleDoor } from '../vehicle/vehicle-door';
import type { VehiclePart } from '../vehicle/vehicle-part';
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

/** Raw driving feel from `handling.cfg` (the gameplay layer scales these into its model). */
export interface VehicleHandling {
  /** Braking deceleration. */
  brakeDecel: number;
  /** Engine acceleration. */
  engineAccel: number;
  /** Mass (kg) — heavier = less agile. */
  mass: number;
  /** Top speed (GTA units). */
  maxVelocity: number;
  /** Steering lock, degrees. */
  steeringLock: number;
}

/** A loaded vehicle: the renderable, its model-space collision, wheel rig, doors and seats. */
export interface VehicleModel {
  /** Collision in model space (`transforms` empty — the caller sets the placement). The convex
   * hull of its vertices is the dynamic chassis collider; the full COL is kept for damage. */
  colliders: ModelColliders | null;
  /** Swinging doors (open/close about the hinge). */
  doors: VehicleDoor[];
  /** Half-extents `[hx, hy, hz]` (vehicle space) from the collision bounds (door/seat routing). */
  halfExtents: [number, number, number];
  /** Driving feel from handling.cfg. */
  handling: VehicleHandling;
  /** Low-detail LOD group (hidden `*_vlo` meshes under `object`), shown at distance, or null. */
  lod: null | Object3D;
  object: Object3D;
  /** Damageable body parts (`_ok`/`_dam` panels + doors) for the collision-damage system. */
  parts: VehiclePart[];
  /** Env-map-reflective materials (for the vehicle-reflection plugin to apply the active preset). */
  reflectiveMaterials: MeshStandardMaterial[];
  /** Animatable wheels (spin/steer); register with the vehicle system. */
  rig: VehicleRig;
  /** Seat dummy local transforms in vehicle space (null if absent). */
  seats: { backseat: Matrix4 | null; frontseat: Matrix4 | null };
  /** Raycast-wheel placements (hub position, radius, front/rear) for the physics vehicle. */
  wheels: VehicleWheelPlacement[];
}

/** One raycast wheel for the physics vehicle: hub position in vehicle space, radius, axle. */
export interface VehicleWheelPlacement {
  /** Wheel hub position in vehicle space `[x, y, z]`. */
  connection: [number, number, number];
  /** Front wheels steer; all wheels are powered/braked per the drive type. */
  front: boolean;
  /** Rolling radius (world units). */
  radius: number;
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
  /**
   * Load a painted, wheeled vehicle by model name (native Z-up; place under the streaming root).
   * `colour` overrides the paint with carcols palette indices (e.g. `'34,34'` or `'1,31,1,0'`); the
   * first two indices become the primary/secondary paint. Omit to use the car's default carcol combo.
   */
  loadVehicle(modelName: string, colour?: string): Promise<VehicleModel>;
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
