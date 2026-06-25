import { Object3D } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Impact, PhysicsWorld } from '../physics/physics-world';
import type { VehiclePart } from './vehicle-part';

import { Logger } from '../diagnostics/logger';
import { VehicleDamageSystem } from './vehicle-damage.system';

const SILENT_LOGGER = new Logger({ emit: (): undefined => undefined }, { showLogs: false });
const STRONG = 300000; // STRONG_HIT
const CAR_BODY = 7;

/** A fake physics world: a queued impact list (drained by takeImpacts) and an identity car body. */
function fakePhysics(): { impacts: Impact[]; world: PhysicsWorld } {
  const impacts: Impact[] = [];
  const world = {
    readBody: (): { position: Vec3; quaternion: [number, number, number, number] } => ({
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1], // identity → world point == car-local point
    }),
    takeImpacts: (): Impact[] => impacts.splice(0, impacts.length),
  } as unknown as PhysicsWorld;

  return { impacts, world };
}

function impact(force: number, point: null | Vec3): Impact {
  return { bodyA: CAR_BODY, bodyB: null, force, point };
}

function part(name: string, position: Vec3): VehiclePart {
  return { dam: new Object3D(), name, ok: new Object3D(), pivot: new Object3D(), position };
}

describe('VehicleDamageSystem', () => {
  let physics: { impacts: Impact[]; world: PhysicsWorld };
  let system: VehicleDamageSystem;
  let bonnet: VehiclePart;
  let boot: VehiclePart;
  let world: Object3D;
  let carObject: Object3D;

  beforeEach(() => {
    physics = fakePhysics();
    system = new VehicleDamageSystem(physics.world, SILENT_LOGGER);
    bonnet = part('bonnet', [0, 2, 0]); // front
    boot = part('boot', [0, -2, 0]); // rear
    world = new Object3D();
    carObject = new Object3D();
    world.add(carObject);
    carObject.add(bonnet.pivot, boot.pivot);
    bonnet.dam.visible = false;
    boot.dam.visible = false;
    system.add({ body: CAR_BODY, object: carObject, parts: [bonnet, boot] });
  });

  describe('negative cases', () => {
    it('ignores a weak impact (below the strong-hit threshold)', () => {
      physics.impacts.push(impact(STRONG - 1, [0, 2, 0]));
      system.update(0.016);
      expect(bonnet.ok.visible).toBe(true);
      expect(bonnet.dam.visible).toBe(false);
    });

    it('ignores an impact with no contact point', () => {
      physics.impacts.push(impact(STRONG * 2, null));
      system.update(0.016);
      expect(bonnet.dam.visible).toBe(false);
    });

    it('ignores an impact on a body it does not own', () => {
      physics.impacts.push({ bodyA: 999, bodyB: 998, force: STRONG * 2, point: [0, 2, 0] });
      system.update(0.016);
      expect(bonnet.dam.visible).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('deforms the part nearest the hit (swaps ok→dam)', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0])); // at the bonnet
      system.update(0.016);
      expect(bonnet.ok.visible).toBe(false);
      expect(bonnet.dam.visible).toBe(true);
      expect(boot.dam.visible).toBe(false); // the rear panel is untouched
    });

    it('detaches an already-damaged part on a second strong hit', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // deform
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // detach
      // The pivot is reparented out of the car (kept in the world for its fall).
      expect(bonnet.pivot.parent).toBe(world);
    });

    it('changes a part state at most once per frame (deform XOR detach)', () => {
      // Two strong hits on the bonnet in one update: it should deform, not deform AND detach.
      physics.impacts.push(impact(STRONG, [0, 2, 0]), impact(STRONG, [0, 2, 0]));
      system.update(0.016);
      expect(bonnet.dam.visible).toBe(true);
      expect(bonnet.pivot.parent).toBe(carObject); // not detached this frame
    });

    it('removes a detached part once its fall time expires', () => {
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // deform
      physics.impacts.push(impact(STRONG, [0, 2, 0]));
      system.update(0.016); // detach → starts falling (TTL 1.5s)
      system.update(2); // past FALL_TTL
      expect(bonnet.pivot.parent).toBeNull();
    });
  });
});
