import { Quaternion, Vector3 } from 'three';

import type { ColliderBox, ColliderSphere, ModelColliders } from '../interfaces/collider.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Rapier } from './rapier';

/** Gravity along GTA −Z (the world is Z-up; the −90°X is display-only). */
const GRAVITY_Z = -9.81;

/** Extra ray length below a body's half-height when testing for ground contact. */
const GROUND_EPSILON = 0.15;

export interface BodyTransform {
  position: Vec3;
  quaternion: Quat;
}
type Quat = [number, number, number, number];

type RapierBody = ReturnType<RapierWorld['createRigidBody']>;
type RapierWorld = InstanceType<Rapier['World']>;

/**
 * Thin wrapper over a Rapier world (GTA Z-up). Creates dynamic/static box bodies
 * and reads body transforms back for the ECS. Bodies are addressed by their
 * integer handle, which the `RigidBody` component stores per entity.
 */
export class PhysicsWorld {
  private readonly rapier: Rapier;
  private readonly world: RapierWorld;

  constructor(rapier: Rapier) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: 0, z: GRAVITY_Z });
  }

  /** A dynamic box (half-extents) at a Z-up position; returns its body handle. */
  createBox(position: Vec3, halfExtents: Vec3): number {
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.dynamic().setTranslation(...position));
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(...halfExtents), body);

    return body.handle;
  }

  /** A dynamic character box: rotations locked (stays upright) + high friction. */
  createCharacterBody(position: Vec3, halfExtents: Vec3): number {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        .lockRotations(),
    );
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(...halfExtents).setFriction(1), body);

    return body.handle;
  }

  /** A fixed (static) box, e.g. a temporary ground; returns its body handle. */
  createStaticBox(position: Vec3, halfExtents: Vec3): number {
    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed().setTranslation(...position));
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(...halfExtents), body);

    return body.handle;
  }

  /**
   * Build static colliders for the bound map collision: one fixed body per
   * placement (Z-up translation + rotation decomposed from its matrix) carrying
   * the model's trimesh + box + sphere shapes (model space). Returns the number
   * of colliders created. Degenerate trimeshes are skipped.
   */
  createStaticColliders(models: readonly ModelColliders[]): number {
    const translation = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    let count = 0;

    for (const model of models) {
      for (const matrix of model.transforms) {
        matrix.decompose(translation, rotation, scale);
        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed()
            .setTranslation(translation.x, translation.y, translation.z)
            .setRotation({ w: rotation.w, x: rotation.x, y: rotation.y, z: rotation.z }),
        );
        count += this.addShapes(body, model.shape);
      }
    }

    return count;
  }

  dispose(): void {
    this.world.free();
  }

  /** Linear velocity of a body (Z-up). */
  getLinvel(handle: number): Vec3 {
    const v = this.world.getRigidBody(handle).linvel();

    return [v.x, v.y, v.z];
  }

  /** True if a downward ray from the body hits something within half-height (+ ε). */
  isGrounded(handle: number, halfHeight: number): boolean {
    const body = this.world.getRigidBody(handle);
    const p = body.translation();
    const ray = new this.rapier.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: -1 });
    const hit = this.world.castRay(ray, halfHeight + GROUND_EPSILON, true, undefined, undefined, undefined, body);

    return hit !== null;
  }

  readBody(handle: number): BodyTransform {
    const body = this.world.getRigidBody(handle);
    const t = body.translation();
    const r = body.rotation();

    return { position: [t.x, t.y, t.z], quaternion: [r.x, r.y, r.z, r.w] };
  }

  /** Set a body's linear velocity (Z-up). */
  setLinvel(handle: number, velocity: Vec3): void {
    this.world.getRigidBody(handle).setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }

  private addBox(body: RapierBody, box: ColliderBox): number {
    const hx = (box.max[0] - box.min[0]) / 2;
    const hy = (box.max[1] - box.min[1]) / 2;
    const hz = (box.max[2] - box.min[2]) / 2;
    if (hx <= 0 || hy <= 0 || hz <= 0) {
      return 0;
    }
    const cx = (box.max[0] + box.min[0]) / 2;
    const cy = (box.max[1] + box.min[1]) / 2;
    const cz = (box.max[2] + box.min[2]) / 2;
    this.world.createCollider(this.rapier.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz), body);

    return 1;
  }

  private addShapes(body: RapierBody, shape: ModelColliders['shape']): number {
    let count = this.addTrimesh(body, shape.vertices, shape.indices);
    for (const box of shape.boxes) {
      count += this.addBox(body, box);
    }
    for (const sphere of shape.spheres) {
      count += this.addSphere(body, sphere);
    }

    return count;
  }

  private addSphere(body: RapierBody, sphere: ColliderSphere): number {
    if (sphere.radius <= 0) {
      return 0;
    }
    const [x, y, z] = sphere.center;
    this.world.createCollider(this.rapier.ColliderDesc.ball(sphere.radius).setTranslation(x, y, z), body);

    return 1;
  }

  private addTrimesh(body: RapierBody, vertices: Float32Array, indices: Uint32Array): number {
    if (vertices.length === 0 || indices.length === 0) {
      return 0;
    }
    try {
      this.world.createCollider(this.rapier.ColliderDesc.trimesh(vertices, indices), body);

      return 1;
    } catch {
      return 0; // skip a degenerate trimesh rather than fail the whole region
    }
  }
}
