import { Group, type Object3D } from 'three';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { RegionRequest, WorldAdapter, WorldObjectInfo } from '../interfaces/world-adapter.interface';

// game/adapters/** is the only place allowed to import renderware.
import {
  buildColliders,
  buildCollisionIndex,
  buildCollisionWireframe,
  buildRegion,
  type ImgArchive,
  loadArchive,
  type MapDefinitions,
  type RegionColliders,
  type RegionMeshData,
  resolveMap,
} from '../../renderware';

export interface GtaSaWorldConfig {
  archiveUrl: string;
  base: string;
  datUrl: string;
}

/**
 * Bridges the generic engine to GTA SA / renderware. Downloads the WIMG archive
 * and resolves the map, then builds instanced regions and reports picked objects.
 * The −90°X (GTA Z-up → three Y-up) lives here, not in the engine.
 */
export class GtaSaWorldAdapter implements WorldAdapter {
  private archive: ImgArchive | null = null;
  private readonly config: GtaSaWorldConfig;
  private defs: MapDefinitions | null = null;

  constructor(config: GtaSaWorldConfig) {
    this.config = config;
  }

  describe(object: Object3D, instanceId?: number): null | WorldObjectInfo {
    const data = object.userData.region as RegionMeshData | undefined;
    const instance = instanceId === undefined ? undefined : data?.instances[instanceId];
    if (!data || !instance) {
      return null;
    }

    return { modelName: data.def.modelName, position: instance.position, txdName: data.def.txdName };
  }

  // eslint-disable-next-line
  async loadColliders(request: RegionRequest): Promise<ModelColliders[]> {
    if (!this.archive || !this.defs) {
      throw new Error('GtaSaWorldAdapter.loadColliders called before prepare()');
    }
    const index = buildCollisionIndex(this.archive);
    const colliders = buildColliders(index, this.defs, { center: request.center, radius: request.radius });

    return colliders.map(toModelColliders);
  }

  // eslint-disable-next-line
  async loadCollisionDebug(request: RegionRequest): Promise<Object3D[]> {
    if (!this.archive || !this.defs) {
      throw new Error('GtaSaWorldAdapter.loadCollisionDebug called before prepare()');
    }
    const index = buildCollisionIndex(this.archive);
    const colliders = buildColliders(index, this.defs, { center: request.center, radius: request.radius });
    const root = new Group();
    root.rotation.x = -Math.PI / 2; // GTA Z-up → three.js Y-up (matches loadRegion)
    root.add(buildCollisionWireframe(colliders));

    return [root];
  }

  // eslint-disable-next-line
  async loadRegion(request: RegionRequest): Promise<Object3D[]> {
    if (!this.archive || !this.defs) {
      throw new Error('GtaSaWorldAdapter.loadRegion called before prepare()');
    }
    const meshes = buildRegion(this.archive, this.defs, {
      center: request.center,
      geometry: request.geometry,
      radius: request.radius,
    });
    const root = new Group();
    root.rotation.x = -Math.PI / 2; // GTA Z-up → three.js Y-up
    for (const mesh of meshes) {
      root.add(mesh);
    }

    return [root];
  }

  async prepare(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.archive && this.defs) {
      onProgress?.(1); // already prepared (e.g. a debug reload) — skip the heavy work

      return;
    }
    this.archive = await loadArchive(this.config.archiveUrl);
    this.defs = await resolveMap(this.config.datUrl, this.config.base);
    onProgress?.(1);
  }
}

/** Convert renderware collision (COL model + placements) to the engine's generic shape. */
export function toModelColliders({ col, name, transforms }: RegionColliders): ModelColliders {
  const indices = new Uint32Array(col.faces.length * 3);
  col.faces.forEach((face, i) => {
    indices[i * 3] = face.a;
    indices[i * 3 + 1] = face.b;
    indices[i * 3 + 2] = face.c;
  });

  return {
    name,
    shape: {
      boxes: col.boxes.map((box) => ({ max: box.max, min: box.min })),
      indices,
      spheres: col.spheres.map((sphere) => ({ center: sphere.center, radius: sphere.radius })),
      vertices: col.vertices,
    },
    transforms,
  };
}
