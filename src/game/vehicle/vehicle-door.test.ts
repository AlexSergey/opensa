import { Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { VehicleDoor } from './vehicle-door';

import { setDoorAngle } from './vehicle-door';

function door(closed: Quaternion): VehicleDoor {
  return { closed, pivot: new Object3D(), side: 'lf' };
}

const Z = new Vector3(0, 0, 1);

describe('setDoorAngle', () => {
  describe('negative cases', () => {
    it('returns the door to its closed orientation at angle 0', () => {
      const closed = new Quaternion().setFromAxisAngle(Z, 0.4);
      const d = door(closed);
      setDoorAngle(d, 1); // open
      setDoorAngle(d, 0); // close again
      expect(d.pivot.quaternion.angleTo(closed)).toBeCloseTo(0);
    });
  });

  describe('positive cases', () => {
    it('swings the door about the hinge by the given angle from closed', () => {
      const closed = new Quaternion(); // identity closed state
      const d = door(closed);
      setDoorAngle(d, 0.7);
      expect(d.pivot.quaternion.angleTo(new Quaternion().setFromAxisAngle(Z, 0.7))).toBeCloseTo(0);
    });

    it('composes the swing on top of a rotated closed state', () => {
      const closed = new Quaternion().setFromAxisAngle(Z, 0.5);
      const d = door(closed);
      setDoorAngle(d, 0.3);
      expect(d.pivot.quaternion.angleTo(new Quaternion().setFromAxisAngle(Z, 0.8))).toBeCloseTo(0);
    });
  });
});
