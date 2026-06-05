import { addComponent, addEntity } from 'bitecs';
import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';

import { PlayerControlled, Transform } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { RenderSyncSystem } from './render-sync.system';

function spawnEntity(world: ReturnType<typeof createEcsWorld>, transform: number[]): number {
  const eid = addEntity(world);
  addComponent(world, eid, Transform);
  addComponent(world, eid, PlayerControlled);
  [Transform.x[eid], Transform.y[eid], Transform.z[eid]] = transform.slice(0, 3);
  [Transform.qx[eid], Transform.qy[eid], Transform.qz[eid], Transform.qw[eid]] = transform.slice(3);

  return eid;
}

describe('RenderSyncSystem', () => {
  describe('negative cases', () => {
    it('skips entities that have no registered render object', () => {
      const world = createEcsWorld();
      spawnEntity(world, [1, 2, 3, 0, 0, 0, 1]);

      expect(() => new RenderSyncSystem(world, new Map()).update()).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('copies the ECS Transform onto the linked object', () => {
      const world = createEcsWorld();
      const object = new Object3D();
      const eid = spawnEntity(world, [10, 20, 30, 0, 0, Math.SQRT1_2, Math.SQRT1_2]);

      new RenderSyncSystem(world, new Map([[eid, object]])).update();

      expect([object.position.x, object.position.y, object.position.z]).toEqual([10, 20, 30]);
      expect(object.quaternion.z).toBeCloseTo(Math.SQRT1_2);
      expect(object.quaternion.w).toBeCloseTo(Math.SQRT1_2);
    });
  });
});
