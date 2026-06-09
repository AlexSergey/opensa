import { type AnimationClip, Group, type Object3D, type Texture } from 'three';

import type { ModelColliders } from '../interfaces/collider.interface';
import type {
  CellRequest,
  CharacterModel,
  RegionRequest,
  VehicleHandling,
  VehicleModel,
  WorldAdapter,
  WorldObjectInfo,
} from '../interfaces/world-adapter.interface';
import type { CellCoord } from '../streaming/grid';

// game/adapters/** is the only place allowed to import renderware.
import {
  buildAnimationClip,
  buildCell,
  buildCellColliders,
  buildClump,
  buildColliders,
  buildCollisionIndex,
  buildCollisionWireframe,
  buildSkinnedClump,
  buildTextureMap,
  buildTimecyc,
  buildVehicle,
  buildWater,
  buildWorldGrid,
  convertTo24h,
  type HandlingEntry,
  type ImgArchive,
  loadArchive,
  type MapDefinitions,
  oceanFrame,
  parseCarcols,
  parseDff,
  parseDffCollision,
  parseHandling,
  parseIfp,
  parseTimecyc,
  parseTxd,
  parseVehicleDefs,
  parseWater,
  type RegionColliders,
  type RegionMeshData,
  resolveMap,
  setTxdParents,
  type Timecyc,
  type VehicleColours,
  type VehicleDef,
  type WorldGrid,
} from '../../renderware';
import { VehicleRig } from '../vehicle/vehicle-rig';

/** Sea level (Z) + a large background plane half-size so the ocean reaches the horizon. */
const SEA_LEVEL = 0;
const SEA_HALF = 16000;

export interface GtaSaWorldConfig {
  archiveUrl: string;
  base: string;
  cellSize: number;
  datUrl: string;
}

/** Resolved carcol paint (RGB per slot); 3rd/4th present only for 4-colour cars. */
interface VehiclePaint {
  primary: [number, number, number];
  quaternary?: [number, number, number];
  secondary: [number, number, number];
  tertiary?: [number, number, number];
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
  private genericVehicleTextures: Map<string, Texture> | null = null;
  private grid: null | WorldGrid = null;
  /** Parsed `handling.cfg`, kept for the later vehicle-physics phase. */
  private handling: Map<string, HandlingEntry> | null = null;
  private vehicleColours: null | VehicleColours = null;
  private vehicleDefs: Map<string, VehicleDef> | null = null;

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
   * Load one IFP (e.g. `ped.ifp`) from a packed WIMG animation archive into
   * `THREE.AnimationClip`s keyed by lowercased animation name. The archive
   * (built by `scripts/pack-anim-img.mjs`) bundles every IFP; it is cached, so
   * loading other IFPs from it later is free.
   */
  async loadAnimations(archiveUrl: string, ifpName: string): Promise<Map<string, AnimationClip>> {
    const archive = await loadArchive(archiveUrl);
    const buffer = archive.get(ifpName);
    if (!buffer) {
      throw new Error(`Animation '${ifpName}' not found in ${archiveUrl}`);
    }
    const clips = new Map<string, AnimationClip>();
    for (const anim of parseIfp(buffer)) {
      clips.set(anim.name.toLowerCase(), buildAnimationClip(anim));
    }

    return clips;
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

  /**
   * Load the timecyc (per-weather, per-hour colour/lighting table), always as 24h.
   * Uses the optional `timecyc_24h.dat` as-is when present, else converts the
   * mandatory vanilla `timecyc.dat` (8 keyframes/weather) to 24h.
   */
  async loadTimecyc(): Promise<Timecyc> {
    const base = this.config.base;
    const text24 = await tryFetchText(`${base}/data/timecyc_24h.dat`);
    if (text24 !== null) {
      return buildTimecyc(parseTimecyc(text24));
    }
    const baseText = await fetchText(`${base}/data/timecyc.dat`);

    return buildTimecyc(convertTo24h(parseTimecyc(baseText)));
  }

  /**
   * Load a painted, wheeled vehicle by model name. Resolves its `vehicles.ide`
   * definition (txd + wheel scale) and carcol colours, merges the generic
   * `vehicle.txd` with the car's own TXD, builds the mesh, and extracts the
   * collision embedded in the DFF (model space — the caller sets the placement).
   * Native Z-up — the caller parents it under the −90°X streaming root.
   */
  async loadVehicle(modelName: string, colour?: string): Promise<VehicleModel> {
    await this.ensureVehicleData();
    const name = modelName.toLowerCase();
    const def = this.vehicleDefs?.get(name);
    if (!def) {
      throw new Error(`No vehicle definition for '${modelName}' in vehicles.ide`);
    }

    const base = this.config.base;
    const [dffBuffer, carTxdBuffer, genericTextures] = await Promise.all([
      fetchBuffer(`${base}/vehicles/${def.model}.dff`),
      fetchBuffer(`${base}/vehicles/${def.txd}.txd`),
      this.loadGenericVehicleTextures(),
    ]);
    const textures = new Map<string, Texture>([...genericTextures, ...buildTextureMap(parseTxd(carTxdBuffer))]);
    const indices = colour
      ? colour
          .split(',')
          .map((cell) => Number(cell.trim()))
          .filter((value) => Number.isFinite(value))
      : undefined;
    const paint = this.resolveVehicleColours(name, indices);

    const built = buildVehicle(parseDff(dffBuffer), textures, { ...paint, wheelScale: def.wheelScale });
    const col = parseDffCollision(dffBuffer);
    const colliders = col ? toModelColliders({ col, name: col.name, transforms: [] }) : null;
    // Half-extents from the collision bounds — robust to stray vertices in modded DFFs
    // (a mesh bbox can blow up); the COL is authored clean.
    const halfExtents: [number, number, number] = col
      ? [
          Math.max(Math.abs(col.bounds.min[0]), Math.abs(col.bounds.max[0])),
          Math.max(Math.abs(col.bounds.min[1]), Math.abs(col.bounds.max[1])),
          Math.max(Math.abs(col.bounds.min[2]), Math.abs(col.bounds.max[2])),
        ]
      : [1.2, 2.5, 0.7];

    return {
      colliders,
      doors: built.doors,
      halfExtents,
      handling: this.vehicleHandling(def.handlingId),
      lod: built.lod,
      object: built.root,
      parts: built.parts,
      reflectiveMaterials: built.reflectiveMaterials,
      rig: new VehicleRig(built.wheels),
      seats: built.seats,
      wheels: built.wheels.map((wheel) => ({
        connection: wheel.connection,
        front: wheel.front,
        radius: wheel.radius,
      })),
    };
  }

  /**
   * Build the flat water surface from `water.dat`, textured with `waterclear256`.
   * `water.dat` only covers the map, so the ocean is a single large sea-level plane
   * (reaching the horizon); the file's non-sea-level polygons (lakes) are kept on
   * top. (Sea-level file polygons are dropped — the big plane covers them.)
   */
  async loadWater(waterUrl: string, txdUrl: string): Promise<Object3D> {
    const [waterText, txdBuffer] = await Promise.all([fetchText(waterUrl), fetchBuffer(txdUrl)]);
    const texture = buildTextureMap(parseTxd(txdBuffer)).get('waterclear256');
    if (!texture) {
      throw new Error(`Water texture 'waterclear256' not found in ${txdUrl}`);
    }

    // Real water.dat polygons (correct coverage — tunnels under land stay dry), plus an open-ocean
    // frame filling out to the horizon around the data's bounds (a full plane would flood tunnels).
    const quads = parseWater(waterText);

    return buildWater([...quads, ...oceanFrame(quads, SEA_HALF, SEA_LEVEL)], texture);
  }

  async prepare(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.archive && this.defs) {
      onProgress?.(1); // already prepared (e.g. a debug reload) — skip the heavy work

      return;
    }
    this.archive = await loadArchive(this.config.archiveUrl);
    this.defs = await resolveMap(this.config.datUrl, this.config.base);
    setTxdParents(this.defs.txdParents ?? new Map<string, string>()); // wire txdp: area TXDs inherit *_gene parents
    this.grid = buildWorldGrid(this.defs, this.cellSize);
    onProgress?.(1);
  }

  /** Lazily fetch + parse vehicles.ide, carcols.dat and handling.cfg (cached). */
  private async ensureVehicleData(): Promise<void> {
    if (this.vehicleDefs && this.vehicleColours && this.handling) {
      return;
    }
    const base = this.config.base;
    const [ide, carcols, handling] = await Promise.all([
      fetchText(`${base}/data/vehicles.ide`),
      fetchText(`${base}/data/carcols.dat`),
      fetchText(`${base}/data/handling.cfg`),
    ]);
    this.vehicleDefs = parseVehicleDefs(ide);
    this.vehicleColours = parseCarcols(carcols);
    this.handling = parseHandling(handling); // stored for the later vehicle-physics phase
  }

  /** The shared generic `vehicle.txd` texture map, parsed once. */
  private async loadGenericVehicleTextures(): Promise<Map<string, Texture>> {
    if (!this.genericVehicleTextures) {
      const buffer = await fetchBuffer(`${this.config.base}/models/generic/vehicle.txd`);
      this.genericVehicleTextures = buildTextureMap(parseTxd(buffer));
    }

    return this.genericVehicleTextures;
  }

  /** First carcol combo for a model → primary/secondary RGB (falls back to white). */
  private resolveVehicleColours(name: string, indices?: number[]): VehiclePaint {
    const colours = this.vehicleColours;
    const white: [number, number, number] = [255, 255, 255];
    const rgb = (index: number): [number, number, number] => colours?.palette[index] ?? white;
    const paint = (combo: readonly number[]): VehiclePaint => ({
      primary: rgb(combo[0]),
      quaternary: combo[3] === undefined ? undefined : rgb(combo[3]),
      secondary: rgb(combo[1] ?? combo[0]),
      tertiary: combo[2] === undefined ? undefined : rgb(combo[2]),
    });

    // Explicit carcols indices (e.g. '37,37' / '0,6,3,0') win.
    if (indices && indices.length > 0) {
      return paint(indices);
    }
    const combo = colours?.cars.get(name)?.[0];
    if (combo) {
      return paint(combo);
    }
    const combo4 = colours?.cars4.get(name)?.[0];
    if (combo4) {
      return paint(combo4);
    }

    return { primary: white, secondary: white };
  }

  /** Driving feel for a handling id (handling.cfg columns), with sane fallbacks. */
  private vehicleHandling(handlingId: string): VehicleHandling {
    const fields = this.handling?.get(handlingId)?.fields;
    const num = (index: number, fallback: number): number => {
      const value = Number(fields?.[index]);

      return Number.isFinite(value) ? value : fallback;
    };

    return {
      brakeDecel: num(16, 8.5),
      engineAccel: num(12, 22),
      mass: num(0, 1500),
      maxVelocity: num(11, 160),
      steeringLock: num(19, 30),
    };
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

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

/** Fetch text, or null when the file is absent (for optional assets like `timecyc_24h.dat`). */
async function tryFetchText(url: string): Promise<null | string> {
  const response = await fetch(url);

  return response.ok ? response.text() : null;
}
