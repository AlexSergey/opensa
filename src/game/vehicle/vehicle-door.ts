import type { Object3D } from 'three';

import { Quaternion, Vector3 } from 'three';

/** One swinging door: the group to rotate plus its closed-state hinge orientation. */
export interface VehicleDoor {
  /** Closed-state hinge quaternion. */
  closed: Quaternion;
  /** Group rotated about the hinge (its mesh is hinge-relative). */
  pivot: Object3D;
  /** 'lf' | 'rf' | 'lr' | 'rr'. */
  side: string;
}

/** Hinge axis: the vehicle's up (native Z-up). */
const HINGE = new Vector3(0, 0, 1);

const swing = new Quaternion();

/** Set a door's open angle (radians; 0 = closed) about its hinge. */
export function setDoorAngle(door: VehicleDoor, angle: number): void {
  swing.setFromAxisAngle(HINGE, angle);
  door.pivot.quaternion.copy(door.closed).multiply(swing);
}
