import { type AnimationClip, Group, type InstancedMesh, Matrix4, type Object3D, type Texture, Vector3 } from 'three';

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
import type { WorldMod } from '../mods/mod.interface';
import type { CellCoord } from '../streaming/grid';

// game/adapters/** (and game/mods/**) are the only places allowed to import renderware.
import {
  type AssetFileSystem,
  breakableInstanceKey,
  buildAnimationClip,
  buildCell,
  buildCellColliders,
  buildClump,
  buildColliders,
  buildCollisionIndex,
  buildCollisionWireframe,
  buildProcObjMeshes,
  buildSkinnedClump,
  buildTextureMap,
  buildTimecyc,
  buildVehicle,
  buildWater,
  buildWorldGrid,
  ColDamageEffect,
  convertTo24h,
  getBreakable,
  groupRulesBySurface,
  type HandlingEntry,
  type IdeObjectDef,
  type MapDefinitions,
  type ObjectDatEntry,
  oceanFrame,
  parseCarcols,
  parseDff,
  parseDffCollision,
  parseHandling,
  parseIfp,
  parseObjectDat,
  parsePedDefs,
  parseProcObj,
  parseSurfaceNames,
  parseTimecyc,
  parseTxd,
  parseVehicleDefs,
  parseWater,
  type ProcObjBatch,
  type ProcObjCategoryName,
  procObjColliders,
  procObjLotteryCap,
  type ProcObjRule,
  type RegionColliders,
  type RegionMeshData,
  type RenderPart,
  resolveMap,
  scatterProcObjects,
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

/** object.dat collision-damage effects that smash a prop on impact (plan 045). Props with one of
 *  these but no RW Breakable atomic shatter their render geometry; props WITH an atomic break
 *  regardless. `none`/`changeModel` are excluded (not a shatter). */
const BREAKABLE_EFFECTS = new Set<number>([
  ColDamageEffect.breakable,
  ColDamageEffect.breakableThenRemoved,
  ColDamageEffect.changeThenSmash,
  ColDamageEffect.smashCompletely,
]);

export interface GtaSaWorldConfig {
  cellSize: number;
  /** Standalone script-gated binary IPL groups to load (plan 042) — the world-state choice
   *  vanilla makes via mission-script LOAD_IPL/REMOVE_IPL (e.g. `truthsfarm`, `barriers1`). */
  extraIpl?: readonly string[];
  /** The asset source (plan 050) — all models/textures/data are read from here, not fetched. */
  fs: AssetFileSystem;
  /** Installed game mods (plan 039) — their `decoratePart` hooks run during cell builds. */
  mods?: readonly WorldMod[];
  /** Effective clutter density per category (0 when disabled) — keeps clutter COLLISION in sync
   *  with the rendered set. On a knob change, call {@link GtaSaWorldAdapter.invalidateColliderCache}
   *  and re-stream physics. Default: vanilla density 1 for every category. */
  procObjDensityOf?: (category: ProcObjCategoryName) => number;
  /** Hard cap on clutter instances per cell — over the limit, the highest-lottery placements
   *  are simply not RENDERED and therefore not collided either (one budget drives both; lowest
   *  lotteries win). The vanilla CProcObjectMan pools at ~300 for the same perf reason.
   *  Default: unlimited. */
  procObjLimit?: number;
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

  /** Lowercased model names that "smash" per object.dat but carry no RW Breakable atomic (plan 045) —
   *  their shatter mesh is synthesized from the render geometry. Built in {@link prepare}. */
  private readonly breakableModels = new Set<string>();
  private readonly cellCache = new Map<string, Object3D[]>();
  private readonly colliderCache = new Map<string, ModelColliders[]>();
  private readonly config: GtaSaWorldConfig;
  /** Composed mod build-hook (undefined when no mods) — see {@link GtaSaWorldConfig.mods}. */
  private readonly decoratePart?: (def: IdeObjectDef, part: RenderPart) => void;
  /** Catalog defs by lowercased model name — resolves procobj clutter models to their TXDs. */
  private defByName: Map<string, IdeObjectDef> | null = null;
  private defs: MapDefinitions | null = null;
  private readonly fs: AssetFileSystem;
  private genericVehicleTextures: Map<string, Texture> | null = null;
  private grid: null | WorldGrid = null;
  /** Parsed `handling.cfg`, kept for the later vehicle-physics phase. */
  private handling: Map<string, HandlingEntry> | null = null;
  /** Parsed `object.dat` collision-damage tuning by lowercased model (plan 045); null when absent. */
  private objectDat: Map<string, ObjectDatEntry> | null = null;
  /** Parsed `peds.ide` defs by lowercased model name (TEMP: resolves the env-picked main character). */
  private peds: null | ReturnType<typeof parsePedDefs> = null;
  /** procobj.dat rules by surface name; null when the data files are absent (no scatter). */
  private procObjRules: Map<string, ProcObjRule[]> | null = null;
  /** Surface-name table from surfinfo.dat (index = COL material id); pairs with procObjRules. */
  private surfaceNames: null | string[] = null;
  private vehicleColours: null | VehicleColours = null;
  private vehicleDefs: Map<string, VehicleDef> | null = null;

  constructor(config: GtaSaWorldConfig) {
    this.config = config;
    this.fs = config.fs;
    this.cellSize = config.cellSize;
    const mods = config.mods ?? [];
    this.decoratePart =
      mods.length === 0
        ? undefined
        : (def, part): void => {
            for (const mod of mods) {
              mod.decoratePart?.(def, part);
            }
          };
  }

  /** `object.dat` collision-damage tuning for a model (plan 045), or undefined when absent. The
   *  break system gates on RW Breakable mesh data; this only tunes the impact threshold + marks
   *  indestructible (huge-mass) props. */
  breakableInfo(modelName: string): ObjectDatEntry | undefined {
    return this.objectDat?.get(modelName.toLowerCase());
  }

  /** Identify a picked object: placed map instances via `userData.region`, scattered clutter
   *  via `userData.procObj` (position decomposed from the instance matrix). */
  describe(object: Object3D, instanceId?: number): null | WorldObjectInfo {
    const proc = object.userData.procObj as undefined | { category: string; model: string };
    if (proc && instanceId !== undefined) {
      const matrix = new Matrix4();
      (object as InstancedMesh).getMatrixAt(instanceId, matrix);
      const position = new Vector3().setFromMatrixPosition(matrix);

      return {
        modelName: `${proc.model} [procobj: ${proc.category}]`,
        position: [position.x, position.y, position.z],
        txdName: this.defByName?.get(proc.model)?.txdName ?? '?',
      };
    }
    const data = object.userData.region as RegionMeshData | undefined;
    const instance = instanceId === undefined ? undefined : data?.instances[instanceId];
    if (!data || !instance) {
      return null;
    }

    return { modelName: data.def.modelName, position: instance.position, txdName: data.def.txdName };
  }

  /** Drop the cached per-cell colliders (clutter knobs changed) — the collision streaming system
   *  then re-streams physics via {@link loadCellColliders}, rebuilding with the new density. */
  invalidateColliderCache(): void {
    this.colliderCache.clear();
  }

  listCells(): CellCoord[] {
    if (!this.grid) {
      return [];
    }

    return [...this.grid.values()].map((cell): CellCoord => [cell.cx, cell.cy]);
  }

  /**
   * Load an IFP file (e.g. `anim/ped.ifp`) **directly** — like the original game, no packed archive —
   * into `THREE.AnimationClip`s keyed by lowercased animation name.
   */
  async loadAnimations(ifpName: string): Promise<Map<string, AnimationClip>> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    const clips = new Map<string, AnimationClip>();
    // The build lowercases all packed asset keys (case-insensitive like GTA), so normalise the lookup.
    for (const anim of parseIfp(requireBuffer(this.fs, ifpName.toLowerCase()))) {
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
  async loadCharacter(dffName: string, txdName: string): Promise<CharacterModel> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    // The build lowercases all packed asset keys (case-insensitive like GTA), so normalise the lookup —
    // e.g. a `player/Shrek.dff` request resolves to the packed `player/shrek.dff`.
    const dffBuffer = requireBuffer(this.fs, dffName.toLowerCase());
    const textures = buildTextureMap(parseTxd(requireBuffer(this.fs, txdName.toLowerCase())));
    const clump = parseDff(dffBuffer);

    const skinned = buildSkinnedClump(clump, textures);
    if (skinned) {
      return { bonesByName: skinned.bonesByName, object: skinned.root, skeleton: skinned.skeleton };
    }

    return { bonesByName: new Map(), object: buildClump(clump, textures, { convertToYUp: false }), skeleton: null };
  }

  /**
   * TEMP (bring-your-own-files): load a character by its `peds.ide` model name (e.g. `BMYPOL1`), resolving to
   * the archive's bare `model.dff` / `txd.txd` — for raw installs that have no loose `player/*` files.
   */
  async loadCharacterByModel(modelName: string): Promise<CharacterModel> {
    this.peds ??= parsePedDefs(requireText(this.fs, 'data/peds.ide'));
    const def = this.peds.get(modelName.toLowerCase());
    if (!def) {
      throw new Error(`No ped definition for '${modelName}' in peds.ide`);
    }

    return this.loadCharacter(`${def.model}.dff`, `${def.txd}.txd`);
  }

  // eslint-disable-next-line
  async loadCell(request: CellRequest): Promise<Object3D[]> {
    if (!this.defs || !this.grid) {
      throw new Error('GtaSaWorldAdapter.loadCell called before prepare()');
    }
    const key = `${request.cx},${request.cy},${request.lod ? 'lod' : 'hd'}`;
    let meshes = this.cellCache.get(key);
    if (!meshes) {
      // Native Z-up; the streaming root applies the −90°X (so no per-cell group).
      meshes = buildCell(this.fs, this.defs, this.grid, request.cx, request.cy, request.lod, {
        breakableModels: this.breakableModels,
        decoratePart: this.decoratePart,
      });
      // Procedural clutter (plan 042): deterministic scatter over the cell's collision faces.
      // HD cells only — the clutter draw distances are far below the LOD ring anyway.
      const batches = request.lod ? null : this.cellProcObjBatches(request.cx, request.cy);
      if (batches && this.defByName) {
        const defByName = this.defByName;
        meshes.push(
          ...buildProcObjMeshes(this.fs, batches, (model) => defByName.get(model), {
            decoratePart: this.decoratePart,
            lotteryCap: procObjLotteryCap(batches, this.config.procObjLimit),
          }),
        );
      }
      this.cellCache.set(key, meshes);
    }

    return meshes;
  }

  // eslint-disable-next-line
  async loadCellColliders(cx: number, cy: number): Promise<ModelColliders[]> {
    if (!this.defs || !this.grid) {
      throw new Error('GtaSaWorldAdapter.loadCellColliders called before prepare()');
    }
    const key = `${cx},${cy}`;
    let colliders = this.colliderCache.get(key);
    if (!colliders) {
      const index = buildCollisionIndex(this.fs);
      const archive = this.fs;
      const breakableModels = this.breakableModels;
      colliders = buildCellColliders(index, this.defs, this.grid, cx, cy).map((region) =>
        // Tag breakable-prop placements with their instance keys (plan 045) so a smashed prop's one
        // static body can be dropped — keyed the same way the render registry keys the prop. Matches
        // the render gate: a RW Breakable atomic OR an object.dat smash effect (render-geometry shatter).
        tagBreakable(
          toModelColliders(region),
          getBreakable(archive, region.name) !== undefined || breakableModels.has(region.name),
        ),
      );
      // Clutter collision (plan 042): models that ship a COL collide (rocks/cacti/trees);
      // grass and flower patches have none, so they stay walk-through — like vanilla. The
      // collidable subset follows the live per-category density (no invisible obstacles).
      const batches = this.cellProcObjBatches(cx, cy);
      if (batches) {
        const clutter = procObjColliders(index, batches, {
          densityOf: this.config.procObjDensityOf,
          lotteryCap: procObjLotteryCap(batches, this.config.procObjLimit),
        });
        colliders.push(...clutter.map(toModelColliders));
      }
      this.colliderCache.set(key, colliders);
    }

    return colliders;
  }

  // eslint-disable-next-line
  async loadCollisionDebug(request: RegionRequest): Promise<Object3D[]> {
    if (!this.defs) {
      throw new Error('GtaSaWorldAdapter.loadCollisionDebug called before prepare()');
    }
    const index = buildCollisionIndex(this.fs);
    const colliders = buildColliders(index, this.defs, { center: request.center, radius: request.radius });
    const root = new Group();
    root.rotation.x = -Math.PI / 2; // GTA Z-up → three.js Y-up (matches the streaming root)
    root.add(buildCollisionWireframe(colliders));

    return [root];
  }

  /**
   * Load the timecyc (per-weather, per-hour colour/lighting table), always as 24h.
   * Uses the optional `timecyc_24h.dat` as-is when present, else converts the
   * mandatory vanilla `timecyc.dat` (8 keyframes/weather) to 24h.
   */
  async loadTimecyc(): Promise<Timecyc> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    const text24 = this.fs.getText('data/timecyc_24h.dat');
    if (text24 !== null) {
      return buildTimecyc(parseTimecyc(text24));
    }

    return buildTimecyc(convertTo24h(parseTimecyc(requireText(this.fs, 'data/timecyc.dat'))));
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

    const genericTextures = await this.loadGenericVehicleTextures();
    // Loose `vehicles/<name>` (fetch build) or the bare archive name (raw install, e.g. local loader).
    const dffBuffer = requireFirstBuffer(this.fs, [`vehicles/${def.model}.dff`, `${def.model}.dff`]);
    const carTxdBuffer = requireFirstBuffer(this.fs, [`vehicles/${def.txd}.txd`, `${def.txd}.txd`]);
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
  async loadWater(waterName: string, txdName: string): Promise<Object3D> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    const waterText = requireText(this.fs, waterName);
    const texture = buildTextureMap(parseTxd(requireBuffer(this.fs, txdName))).get('waterclear256');
    if (!texture) {
      throw new Error(`Water texture 'waterclear256' not found in ${txdName}`);
    }

    // Real water.dat polygons (correct coverage — tunnels under land stay dry), plus an open-ocean
    // frame filling out to the horizon around the data's bounds (a full plane would flood tunnels).
    const quads = parseWater(waterText);

    return buildWater([...quads, ...oceanFrame(quads, SEA_HALF, SEA_LEVEL)], texture);
  }

  async prepare(onProgress?: (fraction: number) => void): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.defs) {
      onProgress?.(1); // already prepared (e.g. a debug reload) — skip the heavy work

      return;
    }
    this.defs = resolveMap(this.fs, { extraIpl: this.config.extraIpl });
    setTxdParents(this.defs.txdParents ?? new Map<string, string>()); // wire txdp: area TXDs inherit *_gene parents
    this.grid = buildWorldGrid(this.defs, this.cellSize);
    this.defByName = new Map([...this.defs.catalog.values()].map((def) => [def.modelName.toLowerCase(), def]));
    // Procedural ground clutter (plan 042): both data files present → cells scatter; else skipped.
    const procObjText = this.fs.getText('data/procobj.dat');
    const surfInfoText = this.fs.getText('data/surfinfo.dat');
    if (procObjText !== null && surfInfoText !== null) {
      this.procObjRules = groupRulesBySurface(parseProcObj(procObjText));
      this.surfaceNames = parseSurfaceNames(surfInfoText);
    }
    // Breakable-prop tuning (plan 045) — absent-tolerant: no file, props still break at the default
    // threshold (the break gate is the RW Breakable mesh, not this table).
    const objectDatText = this.fs.getText('data/object.dat');
    if (objectDatText !== null) {
      this.objectDat = parseObjectDat(objectDatText);
      for (const [name, entry] of this.objectDat) {
        if (BREAKABLE_EFFECTS.has(entry.colDamageEffect)) {
          this.breakableModels.add(name); // render-geometry shatter for atomic-less smash props
        }
      }
    }
    onProgress?.(1);
  }

  /** Every carcol paint combo for a model (palette-index tuples) — 2-colour entries then 4-colour;
   *  empty if the car has none. Lets callers cycle paint on repeated spawns (each combo is its OWN car's). */
  async vehicleColourCombos(modelName: string): Promise<number[][]> {
    await this.ensureVehicleData();
    const name = modelName.toLowerCase();
    const colours = this.vehicleColours;

    return [...(colours?.cars.get(name) ?? []), ...(colours?.cars4.get(name) ?? [])].map((combo) => [...combo]);
  }

  /** Deterministic clutter batches for one cell (plan 042), or null when the procobj data files
   *  were absent. Shared by the render path (loadCell) and the collider path (loadCellColliders) —
   *  same inputs give byte-identical batches, so visuals and collision always agree. */
  private cellProcObjBatches(cx: number, cy: number): null | readonly ProcObjBatch[] {
    if (!this.defs || !this.grid || !this.procObjRules || !this.surfaceNames) {
      return null;
    }
    const colliders = buildCellColliders(buildCollisionIndex(this.fs), this.defs, this.grid, cx, cy);

    return scatterProcObjects(colliders, this.procObjRules, this.surfaceNames, cx, cy);
  }

  /** Lazily fetch + parse vehicles.ide, carcols.dat and handling.cfg (cached). */
  private async ensureVehicleData(): Promise<void> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (this.vehicleDefs && this.vehicleColours && this.handling) {
      return;
    }
    const ide = requireText(this.fs, 'data/vehicles.ide');
    const carcols = requireText(this.fs, 'data/carcols.dat');
    const handling = requireText(this.fs, 'data/handling.cfg');
    this.vehicleDefs = parseVehicleDefs(ide);
    this.vehicleColours = parseCarcols(carcols);
    this.handling = parseHandling(handling); // stored for the later vehicle-physics phase
  }

  /** The shared generic `vehicle.txd` texture map, parsed once. */
  private async loadGenericVehicleTextures(): Promise<Map<string, Texture>> {
    await Promise.resolve(); // VFS reads are synchronous; the WorldAdapter API is async
    if (!this.genericVehicleTextures) {
      this.genericVehicleTextures = buildTextureMap(parseTxd(requireBuffer(this.fs, 'models/generic/vehicle.txd')));
    }

    return this.genericVehicleTextures;
  }

  /** First carcol combo for a model → primary/secondary RGB (falls back to white).
   *  Missing 3rd/4th colours default to palette index 0 (black), like SA does for 2-colour cars. */
  private resolveVehicleColours(name: string, indices?: number[]): VehiclePaint {
    const colours = this.vehicleColours;
    const white: [number, number, number] = [255, 255, 255];
    const rgb = (index: number): [number, number, number] => colours?.palette[index] ?? white;
    const paint = (combo: readonly number[]): VehiclePaint => ({
      primary: rgb(combo[0]),
      quaternary: rgb(combo[3] ?? 0),
      secondary: rgb(combo[1] ?? combo[0]),
      tertiary: rgb(combo[2] ?? 0),
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

/** Read a required binary asset from the file system (throws if absent). */
function requireBuffer(fs: AssetFileSystem, name: string): ArrayBuffer {
  const buffer = fs.get(name);
  if (!buffer) {
    throw new Error(`asset not found: ${name}`);
  }

  return buffer;
}

/** First present buffer among `names` (case-insensitive keys), throwing if none exist. */
function requireFirstBuffer(fs: AssetFileSystem, names: readonly string[]): ArrayBuffer {
  for (const name of names) {
    const buffer = fs.get(name.toLowerCase());
    if (buffer) {
      return buffer;
    }
  }
  throw new Error(`asset not found: ${names.join(' | ')}`);
}

/** Read a required text asset from the file system (throws if absent). */
function requireText(fs: AssetFileSystem, name: string): string {
  const text = fs.getText(name);
  if (text === null) {
    throw new Error(`asset not found: ${name}`);
  }

  return text;
}

/** Tag a model's collider placements with breakable instance keys (plan 045); a pass-through for
 *  non-breakable models. The key matches the render registry's (model + cm-rounded translation). */
function tagBreakable(model: ModelColliders, isBreakable: boolean): ModelColliders {
  if (!isBreakable) {
    return model;
  }
  const instanceKeys = model.transforms.map((matrix) =>
    breakableInstanceKey(model.name, [matrix.elements[12], matrix.elements[13], matrix.elements[14]]),
  );

  return { ...model, instanceKeys };
}
