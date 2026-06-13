import type { MeshBasicMaterial, Object3D } from 'three';

import { AdditiveBlending, DoubleSide, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';

import type { ImgArchive } from '../archive';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';
import type { RenderPart } from '../three/build-clump';
import type { EscalatorPathEntry } from '../three/build-escalator';
import type { ParticleEmitterEntry } from '../three/build-particles';
import type { CoronaEntry } from '../three/corona';

import { getClump, getIfp, getTextures, modelKey } from '../archive';
import { hasIdeFlag, IdeFlag } from '../parsers/text';
import { registerAnimatedObject } from '../three/animated-objects';
import { breakableFromGeometry, breakableInstanceKey, registerBreakable } from '../three/breakable';
import { buildAnimatedClump } from '../three/build-animated-clump';
import { buildClumpEscalators, buildClumpLights, buildClumpParticles, buildClumpParts } from '../three/build-clump';
import { buildEscalatorSteps } from '../three/build-escalator';
import { buildRoadsignParts, getRoadsignFont } from '../three/build-roadsign';
import { applyWorldWindowGlow } from '../three/world-material';

/**
 * Models whose 2d-effect lights (coronas + ground pools) are **temporarily suppressed**: traffic lights
 * (`trafficlight1`, `cj_traffic_light*`, `gay_traffic_light`, `mtraffic*`). We don't sequence them yet, so
 * every bulb (red/amber/green) lights at once and casts pools — odd-looking. Remove this filter once
 * traffic-light cycling lands (see plan 032). Street lamps etc. don't match `traffic`, so they're unaffected.
 */
const SUPPRESS_LIGHT_MODELS = /traffic/i;

/**
 * Shared instancing for the streamed map: grouping instances by model+txd and
 * building one `InstancedMesh` per single-material part. Used by the per-cell
 * builder ({@link buildCell}); the map renders through the streaming system.
 */

/** Options threaded from the adapter into the per-cell mesh builders. */
export interface BuildRegionOptions {
  /** Lowercased model names that "smash" on impact per object.dat but carry no RW Breakable atomic
   *  (plan 045) — their shatter mesh is synthesized from the render geometry. Models WITH a shatter
   *  atomic break regardless of this set. */
  breakableModels?: ReadonlySet<string>;
  /** Game-layer mod hook (plan 039): called once per built part, AFTER the vanilla treatment, so a
   *  mod (e.g. vegetation wind) can patch the part's material based on its object def. */
  decoratePart?: (def: IdeObjectDef, part: RenderPart) => void;
}

/** Per-mesh data for click-inspect / describe. */
export interface RegionMeshData {
  def: IdeObjectDef;
  instances: IplInstance[];
}

/** Per-def material treatment from the SA IDE render flags (plans 004/039), all verified on real
 *  assets: backface-culling opt-out (trafficlight1 housings), ADDITIVE glow overlays
 *  (`LTS*`/`nitelites*`), DRAW_LAST sorted-alpha pieces (`*Tr*` block sections), NO_ZBUFFER_WRITE
 *  ground decals (`grnd_alpha*` z-fought the ground they overlay). */
interface DefTreatment {
  additive: boolean;
  drawLast: boolean;
  noDepthWrite: boolean;
  twoSided: boolean;
}

/** Group an instance under its model+txd key (shared by the cell builder). */
export function addToGroup(groups: Map<string, RegionMeshData>, def: IdeObjectDef, instance: IplInstance): void {
  const key = modelKey(def);
  let group = groups.get(key);
  if (!group) {
    group = { def, instances: [] };
    groups.set(key, group);
  }
  group.instances.push(instance);
}

/**
 * Build IDE `anim`-section objects (plan 041): one frame-hierarchy `Group` **per instance**
 * (animation mutates node transforms, so instancing is out — these are rare props: oil pumps,
 * windmills, fans). Each group is placed by its IPL transform, gets the def's IDE-flag treatment,
 * and registers its looping IFP clip with the mixer registry (driven by the game loop).
 */
export function buildAnimatedObjects(archive: ImgArchive, groups: Iterable<RegionMeshData>): Object3D[] {
  const objects: Object3D[] = [];
  for (const group of groups) {
    if (group.def.anim === undefined) {
      continue;
    }
    const clump = getClump(archive, group.def.modelName);
    const textures = getTextures(archive, group.def.txdName);
    const animations = getIfp(archive, group.def.anim);
    const treatment = defTreatment(group.def);
    for (const instance of group.instances) {
      const built = buildAnimatedClump(clump, group.def.modelName, animations, textures);
      for (const material of built.materials) {
        applyTreatment(material, treatment, false);
      }
      built.root.position.set(instance.position[0], instance.position[1], instance.position[2]);
      // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate (matches the meshes).
      built.root.quaternion
        .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
        .conjugate();
      built.root.userData.region = { def: group.def, instances: [instance] } satisfies RegionMeshData;
      if (built.clip) {
        registerAnimatedObject(built.root, built.clip);
      }
      objects.push(built.root);
    }
  }

  return objects;
}

/**
 * Build one `InstancedMesh` per single-material part for each model group, placing
 * every instance with its GTA world transform (IPL quaternion conjugated, unit
 * scale). `userData.region` carries the group for picking.
 */
export function buildInstancedMeshes(
  archive: ImgArchive,
  groups: Iterable<RegionMeshData>,
  options: BuildRegionOptions = {},
): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  const placement = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);

  for (const group of groups) {
    if (group.def.anim !== undefined) {
      continue; // IDE anim objects animate per instance — see buildAnimatedObjects
    }
    const parts = buildClumpParts(getClump(archive, group.def.modelName), getTextures(archive, group.def.txdName));
    // Night-lit timed variants (lit-window / neon overlays, on across midnight) glow additively over
    // the world material's night blend so their bright window texels read in the dark.
    const nightLit = group.def.time !== undefined && isNightWindow(group.def.time.on, group.def.time.off);
    const treatment = defTreatment(group.def);
    for (const part of parts) {
      applyTreatment(part.material, treatment, nightLit);
      options.decoratePart?.(group.def, part); // game-layer mods (e.g. wind sway) — after vanilla
      const mesh = new InstancedMesh(part.geometry, part.material, group.instances.length);
      // The map neither casts nor uses the renderer's shadow receive (plan 038): only dynamics cast,
      // and the unlit world material samples that map manually (worldShadowUniforms).
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.instances.forEach((instance, index) => {
        position.set(instance.position[0], instance.position[1], instance.position[2]);
        // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate.
        quaternion
          .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
          .conjugate();
        placement.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, placement); // parts are in raw model space (no DFF frame transform)
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData.region = group;
      if (group.def.time) {
        mesh.userData.timed = group.def.time; // { on, off } hour window — gated by TimedObjectSystem
        mesh.visible = false; // hidden until the system applies the current hour (avoids a wrong-time flash)
      }
      meshes.push(mesh);
    }
  }

  return meshes;
}

/**
 * Build the road-sign text meshes for a set of model groups (plan 042 item 5): 2dfx ROADSIGN
 * entries bake their positions in **world space**, so the glyph quads render as plain static
 * meshes at identity — one per text colour per model — never through the instanced path.
 * Empty while the `roadsignfont` glyph texture isn't installed.
 */
export function buildRoadsignMeshes(archive: ImgArchive, groups: Iterable<RegionMeshData>): Object3D[] {
  const font = getRoadsignFont();
  if (!font) {
    return [];
  }
  const meshes: Object3D[] = [];
  for (const group of groups) {
    const clump = getClump(archive, group.def.modelName);
    const roadsigns = clump.geometries.flatMap((geometry) => geometry.roadsigns ?? []);
    if (roadsigns.length === 0) {
      continue;
    }
    for (const part of buildRoadsignParts(roadsigns, font)) {
      const mesh = new Mesh(part.geometry, part.material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.region = group; // picking reports the host road model
      meshes.push(mesh);
    }
  }

  return meshes;
}

/**
 * Register every breakable prop among a cell's freshly built InstancedMeshes (plan 045 item 3):
 * group the part meshes by their model group, and for each group whose model carries RW Breakable
 * shatter data — OR whose model `breakableModels` marks "smash" (object.dat collision-damage; the
 * shatter mesh is then synthesized from the render geometry) — register one entry per instance with
 * its world transform + a handle (the group's part meshes + slot) used to collapse the prop on break.
 * The render registry drives the smash; the matching static collider is dropped by the game layer.
 */
export function collectBreakables(
  archive: ImgArchive,
  meshes: readonly InstancedMesh[],
  breakableModels?: ReadonlySet<string>,
): void {
  const byGroup = new Map<RegionMeshData, InstancedMesh[]>();
  for (const mesh of meshes) {
    const group = mesh.userData.region as RegionMeshData | undefined;
    if (!group) {
      continue;
    }
    const list = byGroup.get(group);
    if (list) {
      list.push(mesh);
    } else {
      byGroup.set(group, [mesh]);
    }
  }

  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  for (const [group, groupMeshes] of byGroup) {
    const clump = getClump(archive, group.def.modelName);
    const real = clump.geometries.find((geometry) => geometry.breakable)?.breakable;
    // Fallback: a "smash" prop with no shatter atomic shatters its visible mesh (≤ 65535 verts so the
    // u16 triangle indices don't overflow — props are tiny).
    const synthetic =
      breakableModels?.has(group.def.modelName.toLowerCase()) && clump.geometries[0]?.positions.length / 3 <= 65535
        ? breakableFromGeometry(clump.geometries[0])
        : undefined;
    const breakable = real ?? synthetic;
    if (!breakable || breakable.triangleMaterials.length === 0) {
      continue;
    }
    const textures = getTextures(archive, group.def.txdName);
    group.instances.forEach((instance, slot) => {
      position.set(instance.position[0], instance.position[1], instance.position[2]);
      // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate (matches the meshes).
      quaternion
        .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
        .conjugate();
      registerBreakable({
        breakable,
        key: breakableInstanceKey(group.def.modelName, instance.position),
        meshes: groupMeshes,
        modelName: group.def.modelName,
        position: instance.position,
        slot,
        textures,
        transform: new Matrix4().compose(position, quaternion, scale),
      });
    });
  }
}

/**
 * Gather the world-space (GTA Z-up) **coronas** for a set of model groups: each light-bearing model's
 * clump-local 2d-effect lights (camera-facing glow at the bulb), placed by every instance's transform.
 * (The ground glow under lamps is the road's baked **night vertex colours**, not a projected pool.)
 * Returned flat for one `Points` per cell.
 */
export function collectCoronas(archive: ImgArchive, groups: Iterable<RegionMeshData>): CoronaEntry[] {
  const coronas: CoronaEntry[] = [];
  const placement = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const point = new Vector3();

  for (const group of groups) {
    if (SUPPRESS_LIGHT_MODELS.test(group.def.modelName)) {
      continue; // traffic lights — temporarily off (no sequencing yet); see SUPPRESS_LIGHT_MODELS
    }
    const lights = buildClumpLights(getClump(archive, group.def.modelName));
    if (lights.length === 0) {
      continue;
    }
    for (const instance of group.instances) {
      position.set(instance.position[0], instance.position[1], instance.position[2]);
      // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate (matches the meshes).
      quaternion
        .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
        .conjugate();
      placement.compose(position, quaternion, scale);
      for (const light of lights) {
        point.set(light.position[0], light.position[1], light.position[2]).applyMatrix4(placement);
        coronas.push({
          color: light.color,
          farClip: light.farClip,
          position: [point.x, point.y, point.z],
          size: light.size,
        });
      }
    }
  }

  return coronas;
}

/**
 * Gather the world-space 2dfx particle emitters for a set of model groups (plan 044): each
 * model's clump-local emitters placed by every instance transform — same walk as the coronas.
 */
export function collectParticleEmitters(archive: ImgArchive, groups: Iterable<RegionMeshData>): ParticleEmitterEntry[] {
  const entries: ParticleEmitterEntry[] = [];
  const placement = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const point = new Vector3();

  for (const group of groups) {
    const particles = buildClumpParticles(getClump(archive, group.def.modelName));
    if (particles.length === 0) {
      continue;
    }
    for (const instance of group.instances) {
      position.set(instance.position[0], instance.position[1], instance.position[2]);
      // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate (matches the meshes).
      quaternion
        .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
        .conjugate();
      placement.compose(position, quaternion, scale);
      for (const particle of particles) {
        point.set(particle.position[0], particle.position[1], particle.position[2]).applyMatrix4(placement);
        entries.push({ effectName: particle.effectName, position: [point.x, point.y, point.z] });
      }
    }
  }

  return entries;
}

/** The step model SA's escalator code hardcodes (ModelIndices); its textures live in escstep.txd. */
const ESCALATOR_STEP_MODEL = 'esc_step';

/**
 * Build the moving steps for any 2dfx escalators in a set of model groups (plan 044): clump-local
 * path points placed by every instance transform (same walk as the particles), steps instanced
 * from the vanilla `esc_step` model. Nothing for the (vast majority of) escalator-free groups.
 */
export function buildEscalatorMeshes(
  archive: ImgArchive,
  defs: MapDefinitions,
  groups: Iterable<RegionMeshData>,
): Object3D[] {
  const entries: EscalatorPathEntry[] = [];
  const placement = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const point = new Vector3();

  for (const group of groups) {
    const escalators = buildClumpEscalators(getClump(archive, group.def.modelName));
    if (escalators.length === 0) {
      continue;
    }
    for (const instance of group.instances) {
      position.set(instance.position[0], instance.position[1], instance.position[2]);
      quaternion
        .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
        .conjugate();
      placement.compose(position, quaternion, scale);
      for (const escalator of escalators) {
        const points = escalator.points.map((p) => {
          point.set(p[0], p[1], p[2]).applyMatrix4(placement);

          return [point.x, point.y, point.z] as [number, number, number];
        });
        entries.push({ direction: escalator.direction, points: points as EscalatorPathEntry['points'] });
      }
    }
  }
  if (entries.length === 0) {
    return [];
  }

  const stepDef = findDefByModel(defs, ESCALATOR_STEP_MODEL);
  const parts = buildClumpParts(
    getClump(archive, ESCALATOR_STEP_MODEL),
    getTextures(archive, stepDef?.txdName ?? 'escstep'),
  );

  return buildEscalatorSteps(parts, entries);
}

/** Apply a def's treatment to one part material (mutates it; materials are built per group/object). */
function applyTreatment(material: MeshBasicMaterial, treatment: DefTreatment, nightLit: boolean): void {
  if (treatment.twoSided) {
    material.side = DoubleSide;
  }
  if (treatment.drawLast) {
    material.transparent = true; // three: moves the part into the sorted after-opaque list
  }
  // SA-DEVIATION: NO_ZBUFFER_WRITE (0x40) applied only to ALPHA materials, not opaque (SA applies it
  // to any 0x40 model, but our free camera then shows terrain through — see below).
  // We apply it only to ALPHA materials (decals / shadows / glass — which
  // always also carry DRAW_LAST, so they're transparent here), NOT to opaque geometry. SA itself
  // (VisibilityPlugins.cpp) disables z-write for ANY model with the flag, incl. opaque terrain that
  // ships a bare 0x40 (VegasSland40, cuntwland54b…) — but that only looks right under SA's fixed
  // chase camera. With our free / orbit / top-down camera a non-z-writing opaque ground can't occlude
  // overlapping tiles, so the painter order flips with the angle → see-through holes. Restricting it
  // to alpha keeps the decals/shadows that actually need it and renders terrain solid.
  if (treatment.noDepthWrite && material.transparent) {
    material.depthWrite = false;
  }
  if (treatment.additive) {
    material.blending = AdditiveBlending;
    material.alphaTest = 0; // black texels add nothing — cutout testing only punches holes
  } else if (nightLit && material.map) {
    applyWorldWindowGlow(material); // non-additive timed overlays keep the glow injection
  }
}

/** Resolve a def's treatment once per group. */
function defTreatment(def: IdeObjectDef): DefTreatment {
  const additive = hasIdeFlag(def, IdeFlag.ADDITIVE);

  return {
    additive,
    drawLast: additive || hasIdeFlag(def, IdeFlag.DRAW_LAST),
    noDepthWrite: additive || hasIdeFlag(def, IdeFlag.NO_ZBUFFER_WRITE),
    twoSided: hasIdeFlag(def, IdeFlag.DISABLE_BACKFACE_CULLING),
  };
}

/** Find an object def by model name (escalator cells only — a rare linear scan is fine). */
function findDefByModel(defs: MapDefinitions, modelName: string): IdeObjectDef | undefined {
  for (const def of defs.catalog.values()) {
    if (def.modelName.toLowerCase() === modelName) {
      return def;
    }
  }

  return undefined;
}

/** Whether a timed window `[on, off)` is a night-lit variant (visible across midnight → glowing). */
function isNightWindow(on: number, off: number): boolean {
  if (on === off) {
    return false; // always-on objects aren't specifically night-lit
  }

  return on < off ? on <= 0 && off > 0 : true; // wrapping (e.g. 20→6) = night
}
