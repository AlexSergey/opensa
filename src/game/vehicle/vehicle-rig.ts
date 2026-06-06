import type { Object3D } from 'three';

import { Quaternion, Vector3 } from 'three';

/** One animatable wheel: the group to rotate, plus its role and rolling radius. */
export interface VehicleWheel {
  /** Front wheels steer; all wheels spin. */
  front: boolean;
  /** Wheel radius in world units (roll = distance / radius). */
  radius: number;
  /** Group rotated for spin (about the axle) and steer (front, about up). */
  spinner: Object3D;
}

/** Steer axis: the vehicle's up (native Z-up). */
const UP = new Vector3(0, 0, 1);
/** Spin axis: the wheel axle (left-right) in the spinner's local space. */
const AXLE = new Vector3(1, 0, 0);

/**
 * Animates a vehicle's wheels: rolls them from the travelled distance and steers
 * the front pair. Driving (speed + steer) is fed in via {@link setSpeed} /
 * {@link setSteer}; until vehicle physics exists both stay 0, so wheels are still.
 */
export class VehicleRig {
  private distance = 0;

  private speed = 0;
  private readonly spin = new Quaternion();
  private readonly steer = new Quaternion();
  private steerAngle = 0;
  private readonly wheels: readonly VehicleWheel[];

  constructor(wheels: readonly VehicleWheel[]) {
    this.wheels = wheels;
  }

  /** Forward speed (units/s) that rolls the wheels. */
  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Front-wheel steering angle (radians). */
  setSteer(angle: number): void {
    this.steerAngle = angle;
  }

  update(delta: number): void {
    this.distance += this.speed * delta;
    this.steer.setFromAxisAngle(UP, this.steerAngle);

    for (const wheel of this.wheels) {
      // Negative so positive speed rolls the top of the wheel forward (+Y).
      this.spin.setFromAxisAngle(AXLE, -this.distance / wheel.radius);
      if (wheel.front) {
        wheel.spinner.quaternion.copy(this.steer).multiply(this.spin); // steer, then spin
      } else {
        wheel.spinner.quaternion.copy(this.spin);
      }
    }
  }
}
