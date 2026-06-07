import { Quaternion, Vector3 } from 'three';

import type { System } from '../core/system';
import type { PhysicsWorld } from '../physics/physics-world';
import type { EnterableVehicle } from './enter-vehicle.system';

/** Vehicle forward in model space (GTA cars face +Y). */
const FORWARD = new Vector3(0, 1, 0);
/** Below this forward speed (m/s) the wheels are treated as still (no jitter-roll at rest). */
const ROLL_DEADZONE = 0.1;

/**
 * Owns the dynamic (raycast) vehicles. Each frame it copies the rigid body's
 * transform onto the renderable car and back onto the shared {@link EnterableVehicle}
 * (live `position`/`heading`, read by the enter/seat logic), and rolls the wheels
 * from the car's real displacement. Gravity + suspension keep the cars on their
 * wheels and collide them with the world; the physics step itself (incl.
 * `updateVehicle`) runs in {@link PhysicsWorld.step}.
 */
export class VehiclePhysicsSystem implements System {
  readonly name = 'vehicle-physics';

  private readonly forward = new Vector3();
  /** Previous planar position per car, for displacement-based wheel roll. */
  private readonly lastPlanar = new Map<EnterableVehicle, [number, number]>();
  private readonly physics: PhysicsWorld;
  private readonly quaternion = new Quaternion();
  private readonly vehicles: EnterableVehicle[] = [];

  constructor(physics: PhysicsWorld) {
    this.physics = physics;
  }

  add(vehicle: EnterableVehicle): void {
    this.vehicles.push(vehicle);
    this.lastPlanar.set(vehicle, [vehicle.position[0], vehicle.position[1]]);
  }

  remove(vehicle: EnterableVehicle): void {
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
    this.lastPlanar.delete(vehicle);
  }

  update(delta: number): void {
    for (const car of this.vehicles) {
      const { position, quaternion } = this.physics.readBody(car.body);
      car.position[0] = position[0];
      car.position[1] = position[1];
      car.position[2] = position[2];
      car.object.position.set(position[0], position[1], position[2]);
      this.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      car.object.quaternion.copy(this.quaternion);
      // Heading about Z from the body's forward (+Y) projected onto the ground plane.
      this.forward.copy(FORWARD).applyQuaternion(this.quaternion);
      car.heading = Math.atan2(-this.forward.x, this.forward.y);

      this.rollWheels(car, position, delta);
    }
  }

  /**
   * Roll the wheels from the car's real planar displacement (signed by forward).
   * This is immune to the phantom rigid-body velocity the raycast controller writes
   * while resting, so parked cars keep their wheels still.
   */
  private rollWheels(car: EnterableVehicle, position: readonly number[], delta: number): void {
    const last = this.lastPlanar.get(car) ?? [position[0], position[1]];
    const dx = position[0] - last[0];
    const dy = position[1] - last[1];
    last[0] = position[0];
    last[1] = position[1];
    this.lastPlanar.set(car, last);

    const distance = Math.hypot(dx, dy);
    const forward = dx * this.forward.x + dy * this.forward.y >= 0 ? 1 : -1;
    const speed = delta > 0 ? (forward * distance) / delta : 0;
    car.rig.setSpeed(Math.abs(speed) < ROLL_DEADZONE ? 0 : speed);
    car.rig.update(delta);
  }
}
