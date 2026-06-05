import { Group, type Object3D } from 'three';

import type { RegionRequest, WorldAdapter, WorldObjectInfo } from '../interfaces/world-adapter.interface';

// game/adapters/** is the only place allowed to import renderware.
import {
  buildRegion,
  type ImgArchive,
  loadArchive,
  type MapDefinitions,
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
