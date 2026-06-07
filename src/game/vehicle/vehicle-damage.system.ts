import type { Object3D } from 'three';

import { Quaternion, Vector3 } from 'three';

import type { System } from '../core/system';
import type { Logger } from '../diagnostics/logger';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Impact, PhysicsWorld } from '../physics/physics-world';
import type { VehiclePart } from './vehicle-part';

/** Contact force (N) above which a hit damages a panel (calibrated in-browser: light≈207k, crash≈377k). */
const STRONG_HIT = 300000;
/** Seconds a detached part falls before it disappears. */
const FALL_TTL = 1.5;
/** Gravity for falling parts (GTA Z-up). */
const FALL_GRAVITY = -9.81;
/** Initial knock applied to a detached part (m/s): up + outward + tumble. */
const FALL_UP = 1.5;
const FALL_OUT = 1.5;
const FALL_SPIN = 6;

interface DamageVehicle {
  body: number;
  damaged: Set<VehiclePart>;
  object: Object3D;
  parts: VehiclePart[];
}

interface FallingPart {
  object: Object3D;
  spin: Vector3;
  ttl: number;
  velocity: Vector3;
}

/**
 * Collision damage: on a strong impact, the body part nearest the hit swaps to its
 * `_dam` mesh; a second strong hit on an already-damaged part detaches it (it falls
 * to the ground and is removed after {@link FALL_TTL}). Impacts come from the
 * physics contact-force events ({@link PhysicsWorld.takeImpacts}).
 */
export class VehicleDamageSystem implements System {
  readonly name = 'vehicle-damage';

  private readonly dir = new Vector3();
  private readonly falling: FallingPart[] = [];
  private readonly logger: Logger;
  private readonly physics: PhysicsWorld;
  private readonly quat = new Quaternion();
  private readonly vehicles: DamageVehicle[] = [];

  constructor(physics: PhysicsWorld, logger: Logger) {
    this.physics = physics;
    this.logger = logger;
  }

  add(vehicle: { body: number; object: Object3D; parts: VehiclePart[] }): void {
    this.vehicles.push({ body: vehicle.body, damaged: new Set(), object: vehicle.object, parts: [...vehicle.parts] });
  }

  remove(body: number): void {
    const index = this.vehicles.findIndex((v) => v.body === body);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
  }

  update(delta: number): void {
    // One state change per part per frame: a multi-contact crash shouldn't deform AND
    // detach the same panel in the same instant.
    const touched = new Set<VehiclePart>();
    for (const impact of this.physics.takeImpacts()) {
      this.handleImpact(impact, touched);
    }
    this.advanceFalling(delta);
  }

  /** Advance detached parts: gravity + tumble, then remove once their time is up. */
  private advanceFalling(delta: number): void {
    for (let i = this.falling.length - 1; i >= 0; i -= 1) {
      const part = this.falling[i];
      part.velocity.z += FALL_GRAVITY * delta;
      part.object.position.addScaledVector(part.velocity, delta);
      part.object.rotateX(part.spin.x * delta);
      part.object.rotateY(part.spin.y * delta);
      part.object.rotateZ(part.spin.z * delta);
      part.ttl -= delta;
      if (part.ttl <= 0) {
        part.object.parent?.remove(part.object);
        this.falling.splice(i, 1);
      }
    }
  }

  /** Detach a damaged part: reparent to the world, knock it loose, schedule removal. */
  private detach(car: DamageVehicle, part: VehiclePart): void {
    car.parts = car.parts.filter((p) => p !== part);
    car.damaged.delete(part);
    car.object.parent?.attach(part.pivot); // keep its world transform under the streaming root
    this.falling.push({
      object: part.pivot,
      spin: new Vector3(rand(FALL_SPIN), rand(FALL_SPIN), rand(FALL_SPIN)),
      ttl: FALL_TTL,
      velocity: new Vector3(rand(FALL_OUT), rand(FALL_OUT), FALL_UP),
    });
  }

  private handleImpact(impact: Impact, touched: Set<VehiclePart>): void {
    // Every contact force, gated to `debug` — turn on `showLogs: 'debug'` to recalibrate STRONG_HIT.
    this.logger.debug('damage', `impact force=${impact.force.toFixed(0)}`, impact);
    if (impact.force < STRONG_HIT || !impact.point) {
      return;
    }
    const car = this.vehicles.find((v) => v.body === impact.bodyA || v.body === impact.bodyB);
    if (!car) {
      return;
    }
    const part = this.hitPart(car, impact.point);
    if (!part || touched.has(part)) {
      return;
    }
    touched.add(part);
    if (car.damaged.has(part)) {
      this.detach(car, part); // already damaged → second hit knocks it off
      this.logger.log('damage', `detach ${part.name}`, { force: impact.force, part: part.name });
    } else {
      part.ok.visible = false;
      part.dam.visible = true;
      car.damaged.add(part);
      this.logger.log('damage', `deform ${part.name}`, { force: impact.force, part: part.name });
    }
  }

  /** The damageable part nearest the world-space contact point (mapped into the car's frame). */
  private hitPart(car: DamageVehicle, worldPoint: Vec3): null | VehiclePart {
    const { position, quaternion } = this.physics.readBody(car.body);
    this.quat.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]).invert();
    // World contact point → car-local space (so we compare against parts' vehicle-space positions).
    this.dir.set(worldPoint[0] - position[0], worldPoint[1] - position[1], worldPoint[2] - position[2]);
    this.dir.applyQuaternion(this.quat);

    let best: null | VehiclePart = null;
    let bestDistance = Infinity;
    for (const part of car.parts) {
      const dx = part.position[0] - this.dir.x;
      const dy = part.position[1] - this.dir.y;
      const dz = part.position[2] - this.dir.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = part;
      }
    }

    return best;
  }
}

/** A random value in [-magnitude, +magnitude]. */
function rand(magnitude: number): number {
  return (Math.random() * 2 - 1) * magnitude;
}
