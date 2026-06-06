import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { VehicleWheel } from './vehicle-rig';

import { VehicleRig } from './vehicle-rig';

function quat(axis: Vector3, angle: number): Quaternion {
  return new Quaternion().setFromAxisAngle(axis, angle);
}

function wheel(front: boolean, radius: number): VehicleWheel {
  return { front, radius, spinner: new Object3D() };
}

const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

describe('VehicleRig', () => {
  describe('negative cases', () => {
    it('leaves wheels unrotated while idle (no speed, no steer)', () => {
      const w = wheel(true, 1);
      const rig = new VehicleRig([w]);
      rig.update(1);
      expect(w.spinner.quaternion.angleTo(new Quaternion())).toBeCloseTo(0);
    });

    it('does not steer the rear wheels', () => {
      const w = wheel(false, 1);
      const rig = new VehicleRig([w]);
      rig.setSteer(0.5);
      rig.update(0); // no distance → no spin; rear ignores steer
      expect(w.spinner.quaternion.angleTo(new Quaternion())).toBeCloseTo(0);
    });
  });

  describe('positive cases', () => {
    it('rolls a wheel about its axle by distance / radius', () => {
      const w = wheel(false, 2);
      const rig = new VehicleRig([w]);
      rig.setSpeed(4);
      rig.update(0.5); // distance = 2, angle = -(2 / 2) = -1 rad about X
      expect(w.spinner.quaternion.angleTo(quat(X, -1))).toBeCloseTo(0);
    });

    it('steers the front wheels about the up axis', () => {
      const w = wheel(true, 2);
      const rig = new VehicleRig([w]);
      rig.setSteer(0.3);
      rig.update(0); // no roll → pure steer
      expect(w.spinner.quaternion.angleTo(quat(Z, 0.3))).toBeCloseTo(0);
    });

    it('accumulates roll across updates', () => {
      const w = wheel(false, 1);
      const rig = new VehicleRig([w]);
      rig.setSpeed(1);
      rig.update(1);
      rig.update(1); // total distance = 2 → angle -2 about X
      expect(w.spinner.quaternion.angleTo(quat(X, -2))).toBeCloseTo(0);
    });
  });
});
