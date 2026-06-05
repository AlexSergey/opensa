import { query } from 'bitecs';
import { type Object3D } from 'three';

import type { System } from '../core/system';
import type { EcsWorld } from '../ecs/world';

import { Transform } from '../ecs/components';

/**
 * Copies each entity's ECS {@link Transform} onto its render `Object3D` (native
 * GTA Z-up local transform; the `entityRoot` group applies the −90°X). Runs once
 * per rendered frame. Entities without a registered render object are skipped.
 */
export class RenderSyncSystem implements System {
  readonly name = 'render-sync';

  private readonly renderRefs: Map<number, Object3D>;
  private readonly world: EcsWorld;

  constructor(world: EcsWorld, renderRefs: Map<number, Object3D>) {
    this.world = world;
    this.renderRefs = renderRefs;
  }

  update(): void {
    for (const eid of query(this.world, [Transform])) {
      const object = this.renderRefs.get(eid);
      if (!object) {
        continue;
      }
      object.position.set(Transform.x[eid], Transform.y[eid], Transform.z[eid]);
      object.quaternion.set(Transform.qx[eid], Transform.qy[eid], Transform.qz[eid], Transform.qw[eid]);
    }
  }
}
