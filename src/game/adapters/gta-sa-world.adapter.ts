import { Group, type Object3D } from 'three';

import type { ModelColliders } from '../interfaces/collider.interface';
import type {
  CellRequest,
  CharacterModel,
  RegionRequest,
  WorldAdapter,
  WorldObjectInfo,
} from '../interfaces/world-adapter.interface';
import type { CellCoord } from '../streaming/grid';

// game/adapters/** is the only place allowed to import renderware.
import {
  buildCell,
  buildCellColliders,
  buildClump,
  buildColliders,
  buildCollisionIndex,
  buildCollisionWireframe,
  buildSkinnedClump,
  buildTextureMap,
  buildWorldGrid,
  type ImgArchive,
  loadArchive,
  type MapDefinitions,
  parseDff,
  parseTxd,
  type RegionColliders,
  type RegionMeshData,
  resolveMap,
  type WorldGrid,
} from '../../renderware';

export interface GtaSaWorldConfig {
  archiveUrl: string;
  base: string;
  cellSize: number;
  datUrl: string;
}

/**
 * Bridges the generic engine to GTA SA / renderware. Downloads the WIMG archive
 * and resolves the map, then builds instanced regions and reports picked objects.
 * The −90°X (GTA Z-up → three Y-up) lives here, not in the engine.
 */
export class GtaSaWorldAdapter implements WorldAdapter {
  readonly cellSize: number;

  private archive: ImgArchive | null = null;
  private readonly cellCache = new Map<string, Object3D[]>();
  private readonly colliderCache = new Map<string, ModelColliders[]>();
  private readonly config: GtaSaWorldConfig;
  private defs: MapDefinitions | null = null;
  private grid: null | WorldGrid = null;

  constructor(config: GtaSaWorldConfig) {
    this.config = config;
    this.cellSize = config.cellSize;
  }

  describe(object: Object3D, instanceId?: number): null | WorldObjectInfo {
    const data = object.userData.region as RegionMeshData | undefined;
    const instance = instanceId === undefined ? undefined : data?.instances[instanceId];
    if (!data || !instance) {
      return null;
    }

    return { modelName: data.def.modelName, position: instance.position, txdName: data.def.txdName };
  }

  listCells(): CellCoord[] {
    if (!this.grid) {
      return [];
    }

    return [...this.grid.values()].map((cell): CellCoord => [cell.cx, cell.cy]);
  }

  /**
   * Load a character DFF + TXD. Skinned models (peds) build a `SkinnedMesh` +
   * `Skeleton` (bind pose) and expose the named bones; otherwise a static clump
   * is returned with `skeleton: null`. The renderable is kept in **native** GTA
   * model space (no Z-up→Y-up conversion) — the caller stands it up under the
   * engine's `entityRoot`.
   */
  async loadCharacter(dffUrl: string, txdUrl: string): Promise<CharacterModel> {
    const [dffBuffer, txdBuffer] = await Promise.all([fetchBuffer(dffUrl), fetchBuffer(txdUrl)]);
    const textures = buildTextureMap(parseTxd(txdBuffer));
    const clump = parseDff(dffBuffer);

    const skinned = buildSkinnedClump(clump, textures);
    if (skinned) {
      return { bonesByName: skinned.bonesByName, object: skinned.root, skeleton: skinned.skeleton };
    }

    return { bonesByName: new Map(), object: buildClump(clump, textures, { convertToYUp: false }), skeleton: null };
  }

  // eslint-disable-next-line
  async loadCell(request: CellRequest): Promise<Object3D[]> {
    if (!this.archive || !this.defs || !this.grid) {
      throw new Error('GtaSaWorldAdapter.loadCell called before prepare()');
    }
    const key = `${request.cx},${request.cy},${request.lod ? 'lod' : 'hd'}`;
    let meshes = this.cellCache.get(key);
    if (!meshes) {
      // Native Z-up; the streaming root applies the −90°X (so no per-cell group).
      meshes = buildCell(this.archive, this.defs, this.grid, request.cx, request.cy, request.lod);
      this.cellCache.set(key, meshes);
    }

    return meshes;
  }

  // eslint-disable-next-line
  async loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]> {
    if (!this.archive || !this.defs || !this.grid) {
      throw new Error('GtaSaWorldAdapter.loadCellColliders called before prepare()');
    }
    const key = `${cx},${cy}`;
    let colliders = this.colliderCache.get(key);
    if (!colliders) {
      const index = buildCollisionIndex(this.archive);
      colliders = buildCellColliders(index, this.defs, this.grid, cx, cy).map(toModelColliders);
      this.colliderCache.set(key, colliders);
    }

    return colliders;
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

  async prepare(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.archive && this.defs) {
      onProgress?.(1); // already prepared (e.g. a debug reload) — skip the heavy work

      return;
    }
    this.archive = await loadArchive(this.config.archiveUrl);
    this.defs = await resolveMap(this.config.datUrl, this.config.base);
    this.grid = buildWorldGrid(this.defs, this.cellSize);
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

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.arrayBuffer();
}
