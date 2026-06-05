import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

import type { ImgArchive } from '../archive';
import type { IdeObjectDef, IplInstance } from '../parsers/text';

import { getClump, getTextures, modelKey } from '../archive';
import { buildClumpParts } from '../three/build-clump';

/**
 * Shared instancing for the streamed map: grouping instances by model+txd and
 * building one `InstancedMesh` per single-material part. Used by the per-cell
 * builder ({@link buildCell}); the map renders through the streaming system.
 */

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
