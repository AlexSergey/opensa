import { Matrix4 } from 'three';

import type { CollisionIndex, RegionColliders } from '../collision';
import type { ProcObjCategoryName } from './procobj-categories';
import type { ProcObjBatch } from './procobj-scatter';

import { getCollision } from '../collision';
import { placementMatrix } from './build-procobj';

export interface ProcObjColliderOptions {
  /** Effective density per category (0 = disabled). Default: vanilla density 1. */
  densityOf?: (category: ProcObjCategoryName) => number;
  /** The cell's `procObjLimit` lottery threshold (`procObjLotteryCap`) — collision exists for
   *  exactly the rendered set, never beyond it. Default: unlimited. */
  lotteryCap?: number;
}

/**
 * Collision for scattered clutter (plan 042): vanilla-faithful rule — a clutter model collides
 * iff it ships a COL (rocks `p_rubble*col`, cacti, trees do; grass/flower patches don't, so
 * they stay walk-through). The collidable set IS the rendered set: `lottery <
 * min(densityOf(category), lotteryCap)` — one `procObjLimit` budget drives both rendering and
 * physics, so nothing invisible ever collides. The caller invalidates its collider cache and
 * re-streams physics when the knobs change. Transforms reuse the render `placementMatrix`,
 * scale included (vanilla leaves collision unscaled — a dat-format limitation, not a feature;
 * matching the visual pose is strictly better).
 */
export function procObjColliders(
  index: CollisionIndex,
  batches: readonly ProcObjBatch[],
  options: ProcObjColliderOptions = {},
): RegionColliders[] {
  const densityOf = options.densityOf ?? ((): number => 1);
  const lotteryCap = options.lotteryCap ?? Number.POSITIVE_INFINITY;

  const colliders: RegionColliders[] = [];
  for (const batch of batches) {
    const col = getCollision(index, batch.model);
    if (!col) {
      continue;
    }
    const cutoff = Math.min(densityOf(batch.category), lotteryCap);
    const transforms: Matrix4[] = [];
    for (const placement of batch.placements) {
      if (placement.lottery >= cutoff) {
        break; // placements are lottery-sorted — the rest are above the cutoff too
      }
      transforms.push(placementMatrix(placement, new Matrix4()));
    }
    if (transforms.length > 0) {
      colliders.push({ col, name: batch.model, transforms });
    }
  }

  return colliders;
}
