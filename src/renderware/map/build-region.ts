import { DoubleSide, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

import type { ImgArchive } from '../archive';
import type { IdeObjectDef, IplInstance } from '../parsers/text';
import type { CoronaEntry } from '../three/corona';

import { getClump, getTextures, modelKey } from '../archive';
import { buildClumpLights, buildClumpParts } from '../three/build-clump';

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

/** Emissive intensity for lit-window night models (a touch over 1 so they read as glowing + bloom). */
const WINDOW_EMISSIVE = 1.2;

/**
 * SA IDE object flag: render the model **without backface culling** (two-sided). The original engine
 * culls map geometry by default and disables it per object via this flag (e.g. `trafficlight1` in
 * `dynamic.ide`, flags 2130048) — re-exported assets (gta3-pf.img) rely on it for their mixed-winding
 * housings. Honouring it here replaces the old name-keyed DOUBLE_SIDED_MODELS workaround.
 */
const IDE_FLAG_DISABLE_BACKFACE_CULLING = 0x200000;

/** Per-mesh data for click-inspect / describe. */
export interface RegionMeshData {
  def: IdeObjectDef;
  instances: IplInstance[];
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
 * Build one `InstancedMesh` per single-material part for each model group, placing
 * every instance with its GTA world transform (IPL quaternion conjugated, unit
 * scale). `userData.region` carries the group for picking.
 */
export function buildInstancedMeshes(archive: ImgArchive, groups: Iterable<RegionMeshData>): InstancedMesh[] {
  const meshes: InstancedMesh[] = [];
  const placement = new Matrix4();
  const composed = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);

  for (const group of groups) {
    const parts = buildClumpParts(getClump(archive, group.def.modelName), getTextures(archive, group.def.txdName));
    // Night-lit timed variants (lit-window / neon overlays, on across midnight) self-illuminate so their
    // bright window texels glow in the dark — emissiveMap = the diffuse map (dark texels stay dark).
    const nightLit = group.def.time !== undefined && isNightWindow(group.def.time.on, group.def.time.off);
    const twoSided = (group.def.flags & IDE_FLAG_DISABLE_BACKFACE_CULLING) !== 0;
    for (const part of parts) {
      if (twoSided) {
        part.material.side = DoubleSide; // the def opts out of backface culling, like the original engine
      }
      if (nightLit && part.material.map) {
        part.material.emissiveMap = part.material.map;
        part.material.emissive.setRGB(1, 1, 1);
        part.material.emissiveIntensity = WINDOW_EMISSIVE;
      }
      const mesh = new InstancedMesh(part.geometry, part.material, group.instances.length);
      // Opaque geometry casts; alpha-tested detail (foliage/fences/wires) doesn't — its 1-bit cutout
      // shimmers badly in the shadow map. It still receives shadows.
      mesh.castShadow = !part.material.transparent;
      mesh.receiveShadow = true;
      group.instances.forEach((instance, index) => {
        position.set(instance.position[0], instance.position[1], instance.position[2]);
        // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate.
        quaternion
          .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
          .conjugate();
        placement.compose(position, quaternion, scale);
        composed.multiplyMatrices(placement, part.matrix);
        mesh.setMatrixAt(index, composed);
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

/** Whether a timed window `[on, off)` is a night-lit variant (visible across midnight → glowing). */
function isNightWindow(on: number, off: number): boolean {
  if (on === off) {
    return false; // always-on objects aren't specifically night-lit
  }

  return on < off ? on <= 0 && off > 0 : true; // wrapping (e.g. 20→6) = night
}
