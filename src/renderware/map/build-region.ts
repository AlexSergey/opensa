import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

import type { ImgArchive } from '../archive';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';

import { getClump, getTextures, modelKey } from '../archive';
import { isLodModel } from '../parsers/text';
import { buildClumpParts } from '../three/build-clump';

/** Per-mesh data for click-inspect / describe. */
export interface RegionMeshData {
  def: IdeObjectDef;
  instances: IplInstance[];
}

export interface RegionOptions {
  /** GTA Z-up world centre of the region. */
  center: [number, number, number];
  /** Render the real map (LODs excluded) or only the LOD stand-ins. */
  geometry: 'lods' | 'map';
  /** Load radius in GTA units; use `Infinity` for the whole map. */
  radius: number;
}

/**
 * Build the instanced renderables for a region (framework-agnostic). Filters to
 * exterior (`interior === 0`), the chosen geometry kind, and the radius; groups
 * by model+txd; and emits one `InstancedMesh` per single-material part with the
 * GTA world transforms (IPL quaternion conjugated). `userData.region` carries the
 * source data for picking.
 */
export function buildRegion(archive: ImgArchive, defs: MapDefinitions, options: RegionOptions): InstancedMesh[] {
  const { center, geometry, radius } = options;
  const radiusSq = radius * radius;

  const groups = new Map<string, RegionMeshData>();
  for (const instance of defs.instances) {
    const def = defs.catalog.get(instance.id);
    if (!def || instance.interior !== 0) {
      continue;
    }
    if ((geometry === 'lods') !== isLodModel(def.modelName)) {
      continue;
    }
    const dx = instance.position[0] - center[0];
    const dy = instance.position[1] - center[1];
    if (dx * dx + dy * dy > radiusSq) {
      continue;
    }
    const key = modelKey(def);
    let group = groups.get(key);
    if (!group) {
      group = { def, instances: [] };
      groups.set(key, group);
    }
    group.instances.push(instance);
  }

  const meshes: InstancedMesh[] = [];
  const placement = new Matrix4();
  const composed = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);

  for (const group of groups.values()) {
    const parts = buildClumpParts(getClump(archive, group.def.modelName), getTextures(archive, group.def.txdName));
    for (const part of parts) {
      const mesh = new InstancedMesh(part.geometry, part.material, group.instances.length);
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
      meshes.push(mesh);
    }
  }

  return meshes;
}
