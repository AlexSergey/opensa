import { Matrix4, Quaternion, Vector3 } from 'three';

import type { ColModel } from '../parsers/binary/col-types';
import type { IplInstance, MapDefinitions } from '../parsers/text';
import type { CollisionIndex } from './collision-index';

import { isLodModel } from '../parsers/text';
import { getCollision } from './collision-index';

export interface ColliderOptions {
  /** GTA Z-up world centre of the region. */
  center: [number, number, number];
  /** Load radius in GTA units; use `Infinity` for the whole map. */
  radius: number;
}

/** One model's collision + the world transforms of every placement of it. */
export interface RegionColliders {
  col: ColModel;
  name: string;
  /** World placements in GTA Z-up space (IPL quaternion conjugated, like the render). */
  transforms: Matrix4[];
}

/**
 * Bind collision to placed objects for a region (the static-world counterpart of
 * {@link buildRegion}). Filters to exterior (`interior === 0`), the radius and
 * real (non-LOD) models — LODs have no collision — then groups instances by model
 * name, looks each up in the collision index, and emits one entry per model with
 * the per-placement world transforms. Models without collision are skipped.
 *
 * Transforms use the same convention as rendering (position + conjugated IPL
 * quaternion, unit scale); COL vertices are already in model space, so unlike the
 * render path no per-part frame matrix is applied. Coordinates stay GTA Z-up —
 * the debug overlay reuses the renderer's −90°X group, and physics converts to
 * Y-up at its own seam.
 */
export function buildColliders(
  index: CollisionIndex,
  defs: MapDefinitions,
  options: ColliderOptions,
): RegionColliders[] {
  const { center, radius } = options;
  const radiusSq = radius * radius;

  const groups = new Map<string, IplInstance[]>();
  for (const instance of defs.instances) {
    const def = defs.catalog.get(instance.id);
    if (!def || instance.interior !== 0 || isLodModel(def.modelName)) {
      continue;
    }
    const dx = instance.position[0] - center[0];
    const dy = instance.position[1] - center[1];
    if (dx * dx + dy * dy > radiusSq) {
      continue;
    }
    const key = def.modelName.toLowerCase();
    let instances = groups.get(key);
    if (!instances) {
      instances = [];
      groups.set(key, instances);
    }
    instances.push(instance);
  }

  const colliders: RegionColliders[] = [];
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);

  for (const [name, instances] of groups) {
    const col = getCollision(index, name);
    if (!col) {
      continue;
    }
    const transforms = instances.map((instance) => {
      position.set(instance.position[0], instance.position[1], instance.position[2]);
      // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate.
      quaternion
        .set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3])
        .conjugate();

      return new Matrix4().compose(position, quaternion, scale);
    });
    colliders.push({ col, name, transforms });
  }

  return colliders;
}
