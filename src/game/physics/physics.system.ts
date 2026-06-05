import { query } from 'bitecs';

import type { System } from '../core/system';
import type { EcsWorld } from '../ecs/world';
import type { Config } from '../interfaces/config.interface';
import type { PhysicsWorld } from './physics-world';

import { RigidBody, Transform } from '../ecs/components';

/**
 * Steps the physics world on the fixed step (only while playing), then writes
 * each rigid body's transform back onto its entity's {@link Transform} (which the
 * render-sync system later copies to the mesh). Z-up throughout.
 */
export class PhysicsSystem implements System {
  readonly name = 'physics';

  private readonly config: Readonly<Config>;
  private readonly physics: PhysicsWorld;
  private readonly world: EcsWorld;

  constructor(world: EcsWorld, physics: PhysicsWorld, config: Readonly<Config>) {
    this.world = world;
    this.physics = physics;
    this.config = config;
  }

  fixedUpdate(step: number): void {
    if (this.config.gameState !== 'play') {
      return;
    }
    this.physics.step(step);
    for (const eid of query(this.world, [RigidBody, Transform])) {
      const { position, quaternion } = this.physics.readBody(RigidBody.handle[eid]);
      Transform.x[eid] = position[0];
      Transform.y[eid] = position[1];
      Transform.z[eid] = position[2];
      Transform.qx[eid] = quaternion[0];
      Transform.qy[eid] = quaternion[1];
      Transform.qz[eid] = quaternion[2];
      Transform.qw[eid] = quaternion[3];
    }
  }
}
