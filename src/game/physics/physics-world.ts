import { Quaternion, Vector3 } from 'three';

import type { ColliderBox, ColliderSphere, ModelColliders } from '../interfaces/collider.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Rapier } from './rapier';

/** Gravity along GTA −Z (the world is Z-up; the −90°X is display-only). */
const GRAVITY_Z = -9.81;

/** Extra ray length below a body's half-height when testing for ground contact. */
const GROUND_EPSILON = 0.15;

// Raycast-vehicle suspension tuning (shared by every car). Stiff + well-damped so the chassis
// rests at a small compression — the COL hull bottom sits only ~0.13 m above the wheel contact,
// so a soft/under-damped spring lets the hull sink into the road and bounce (rolling the wheels).
const SUSPENSION_REST = 0.15; // spring rest length: wheel hangs this far below its connection
const SUSPENSION_STIFFNESS = 120;
const SUSPENSION_COMPRESSION = 12; // raised above Bullet-standard 4.4 to damp the launch hop
const SUSPENSION_RELAXATION = 2.3; // Bullet-standard damping (rebound)
const SUSPENSION_MAX_TRAVEL = 0.25;
const SUSPENSION_MAX_FORCE = 40000; // carries the chassis at small compression without overshoot
const WHEEL_FRICTION_SLIP = 10.5; // tyre grip
const PARKING_BRAKE = 80; // holds a parked car put (released by the driver when throttling)
const CHASSIS_LINEAR_DAMPING = 0.1;
const CHASSIS_ANGULAR_DAMPING = 2; // resist pitch-dive / roll-flip / over-sharp yaw (tuned in-browser)
const CHASSIS_FRICTION = 0.4;
const CHASSIS_RESTITUTION = 0.35; // bounce off walls a little instead of sticking dead
const CONTACT_FORCE_THRESHOLD = 400; // min contact force (N) before an impact event is emitted
/** GTA cars face +Y, are Z-up; axle is left-right (X). Indices for the raycast controller. */
const FORWARD_AXIS = 1; // +Y
const UP_AXIS = 2; // +Z

// Collision groups (`membership << 16 | filter`). Vehicle chassis colliders get their own
// membership bit so the player's collider can be made to ignore them while entering/seated
// (so climbing into the dynamic car doesn't shove it), without affecting on-foot collision.
const VEHICLE_GROUP = 0x0002;
const VEHICLE_GROUPS = ((VEHICLE_GROUP << 16) | 0xffff) >>> 0;
const PLAYER_GROUPS_DEFAULT = 0xffffffff; // collide with everything (incl. standing on a car)
const PLAYER_GROUPS_IGNORE_VEHICLES = ((0xffff << 16) | (0xffff & ~VEHICLE_GROUP)) >>> 0;

/** Kinematic character-controller tuning. */
const CONTROLLER_OFFSET = 0.02; // gap kept between the capsule and obstacles
const STEP_HEIGHT = 0.4; // auto-climb kerbs/stairs up to this
const STEP_MIN_WIDTH = 0.1; // minimum landing width to step onto
const SNAP_DISTANCE = 0.4; // stay glued to ground within this (slopes/stairs going down)
const MAX_SLOPE_CLIMB = (50 * Math.PI) / 180; // can't walk up steeper than this
const MIN_SLOPE_SLIDE = (45 * Math.PI) / 180; // slides down slopes steeper than this
/** Capsule is Y-aligned in Rapier; +90° about X stands it along GTA +Z (up). */
const CAPSULE_UPRIGHT: Quat = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];

export interface BodyTransform {
  position: Vec3;
  quaternion: Quat;
}

/** Rapier's kinematic character controller (slide/autostep/snap/slope). */
export type CharacterController = ReturnType<RapierWorld['createCharacterController']>;
/** Result of advancing a kinematic character one step. */
export interface CharacterMove {
  grounded: boolean;
  movement: Vec3;
}

/** A contact-force impact between two bodies in a step (for vehicle collision damage). */
export interface Impact {
  bodyA: null | number;
  bodyB: null | number;
  force: number; // max contact force magnitude (N)
  point: null | Vec3; // world-space contact point (where the hit landed), if available
}
/** Rapier's raycast vehicle controller (engine/brake/steer, suspension, wheels). */
export type VehicleController = ReturnType<RapierWorld['createVehicleController']>;
/** One raycast wheel: its hub position in vehicle space + rolling radius. */
export interface VehicleWheelSpec {
  connection: Vec3;
  radius: number;
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
  private readonly events: InstanceType<Rapier['EventQueue']>;
  /** Contact-force impacts collected during the last {@link step} (drained by {@link takeImpacts}). */
  private impacts: Impact[] = [];
  private readonly rapier: Rapier;
  /** Raycast vehicle controllers, advanced before each {@link step}. */
  private readonly vehicles: VehicleController[] = [];
  private readonly world: RapierWorld;

  constructor(rapier: Rapier) {
    this.rapier = rapier;
    this.world = new rapier.World({ x: 0, y: 0, z: GRAVITY_Z });
    this.events = new rapier.EventQueue(true);
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

  /**
   * Create a kinematic character controller (Z-up) configured for sliding,
   * auto-stepping kerbs/stairs, snapping to ground, and a climbable slope limit.
   */
  createCharacterController(
    offset = CONTROLLER_OFFSET,
    options: { autostep?: boolean; snap?: boolean } = {},
  ): CharacterController {
    const controller = this.world.createCharacterController(offset);
    controller.setUp({ x: 0, y: 0, z: 1 }); // world is Z-up (default is Y-up)
    controller.setSlideEnabled(true);
    if (options.autostep ?? true) {
      controller.enableAutostep(STEP_HEIGHT, STEP_MIN_WIDTH, true);
    }
    if (options.snap ?? true) {
      controller.enableSnapToGround(SNAP_DISTANCE);
    }
    controller.setMaxSlopeClimbAngle(MAX_SLOPE_CLIMB);
    controller.setMinSlopeSlideAngle(MIN_SLOPE_SLIDE);
    controller.setApplyImpulsesToDynamicBodies(true);

    return controller;
  }

  /**
   * A **dynamic** vehicle (Z-up) at a position + heading — a GTA-style raycast
   * car. The chassis collider is built from the **model's COL spheres + boxes**
   * (the convex primitives GTA itself uses for the car body; they hug the contour
   * — low hood, high cabin — and collide with the static world trimesh, which a
   * concave trimesh can't). The COL trimesh is skipped here (trimesh-vs-trimesh
   * generates no contacts) but kept by the caller for damage; a convex hull of the
   * vertices is the fallback when a COL has no primitives. Gravity + four
   * suspension-raycast wheels rest it on its wheels and collide it with the world;
   * the returned controller drives it (engine/brake/steer).
   */
  createDynamicVehicle(
    position: Vec3,
    heading: number,
    shape: ModelColliders['shape'] | null,
    mass: number,
    wheels: readonly VehicleWheelSpec[],
  ): { body: number; controller: VehicleController } {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), heading);
    // No CCD: on the detailed streamed world trimesh it sweeps the body's leading (front) edge
    // and catches on triangle seams → a launch "pop from the front". The chassis spheres are big
    // and the per-step motion is small, so it can't tunnel anyway.
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.dynamic()
        .setTranslation(...position)
        .setRotation({ w: q.w, x: q.x, y: q.y, z: q.z })
        .setLinearDamping(CHASSIS_LINEAR_DAMPING)
        .setAngularDamping(CHASSIS_ANGULAR_DAMPING)
        // Never sleep: a sleeping chassis stops getting suspension forces and slowly sinks into
        // the collision; the first throttle then wakes it and the penetration ejects it ("launch
        // pop" only on the first drive after parking). Keeping it awake holds it on its wheels.
        .setCanSleep(false),
    );
    this.addVehicleHull(body, shape, mass);

    const controller = this.world.createVehicleController(body);
    controller.indexUpAxis = UP_AXIS;
    controller.setIndexForwardAxis = FORWARD_AXIS;
    wheels.forEach((wheel, i) => {
      const [x, y, z] = wheel.connection;
      // Connection raised by the rest length so the fully-extended wheel sits at the model hub.
      controller.addWheel(
        { x, y, z: z + SUSPENSION_REST },
        { x: 0, y: 0, z: -1 },
        { x: 1, y: 0, z: 0 },
        SUSPENSION_REST,
        wheel.radius,
      );
      controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
      controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
      controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
      controller.setWheelMaxSuspensionTravel(i, SUSPENSION_MAX_TRAVEL);
      controller.setWheelMaxSuspensionForce(i, SUSPENSION_MAX_FORCE);
      controller.setWheelFrictionSlip(i, WHEEL_FRICTION_SLIP);
      controller.setWheelBrake(i, PARKING_BRAKE); // parked until a driver throttles
    });
    this.vehicles.push(controller);

    return { body: body.handle, controller };
  }

  /**
   * A kinematic, position-based **capsule** body (Z-aligned) at a Z-up position —
   * the player's movement collider. Returns the body + collider handles. Kinematic
   * bodies ignore world gravity; the caller integrates it and drives the body via
   * {@link moveCharacter}.
   */
  createKinematicCapsule(position: Vec3, radius: number, halfHeight: number): { body: number; collider: number } {
    const body = this.world.createRigidBody(
      this.rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(...position),
    );
    const collider = this.world.createCollider(
      this.rapier.ColliderDesc.capsule(halfHeight, radius).setRotation({
        w: CAPSULE_UPRIGHT[3],
        x: CAPSULE_UPRIGHT[0],
        y: CAPSULE_UPRIGHT[1],
        z: CAPSULE_UPRIGHT[2],
      }),
      body,
    );

    return { body: body.handle, collider: collider.handle };
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
   * the model's trimesh + box + sphere shapes (model space). Returns the created
   * body **handles** (for {@link removeBodies} when a cell unloads); placements
   * whose shapes were all degenerate create no body.
   */
  createStaticColliders(models: readonly ModelColliders[]): number[] {
    const translation = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    const handles: number[] = [];

    for (const model of models) {
      for (const matrix of model.transforms) {
        matrix.decompose(translation, rotation, scale);
        const body = this.world.createRigidBody(
          this.rapier.RigidBodyDesc.fixed()
            .setTranslation(translation.x, translation.y, translation.z)
            .setRotation({ w: rotation.w, x: rotation.x, y: rotation.y, z: rotation.z }),
        );
        if (this.addShapes(body, model.shape) > 0) {
          handles.push(body.handle);
        } else {
          this.world.removeRigidBody(body); // no usable shape — don't keep an empty body
        }
      }
    }

    return handles;
  }

  dispose(): void {
    this.world.free();
  }

  /** Linear velocity of a body (Z-up). */
  getLinvel(handle: number): Vec3 {
    const v = this.world.getRigidBody(handle).linvel();

    return [v.x, v.y, v.z];
  }

  /**
   * Pin a (dynamic) body at a fixed transform with zero velocity — used to hold a parked
   * car perfectly still while the player slides in/out, so the kinematic rider can't shove it.
   */
  holdBody(handle: number, position: Vec3, quaternion: Quat): void {
    const body = this.world.getRigidBody(handle);
    body.setTranslation({ x: position[0], y: position[1], z: position[2] }, true);
    body.setRotation({ w: quaternion[3], x: quaternion[0], y: quaternion[1], z: quaternion[2] }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * Make the player's collider ignore (or again collide with) vehicle chassis. Used
   * while entering/seated so climbing into the dynamic car doesn't shove it; restored
   * on foot so the player can stand on / bump a car.
   */
  ignoreVehicles(colliderHandle: number, ignore: boolean): void {
    const groups = ignore ? PLAYER_GROUPS_IGNORE_VEHICLES : PLAYER_GROUPS_DEFAULT;
    this.world.getCollider(colliderHandle).setCollisionGroups(groups);
  }

  /** True if a downward ray from the body hits something within half-height (+ ε). */
  isGrounded(handle: number, halfHeight: number): boolean {
    const body = this.world.getRigidBody(handle);
    const p = body.translation();
    const ray = new this.rapier.Ray({ x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: -1 });
    const hit = this.world.castRay(ray, halfHeight + GROUND_EPSILON, true, undefined, undefined, undefined, body);

    return hit !== null;
  }

  /**
   * Advance a kinematic capsule one step: ask the controller for the
   * collision-corrected movement for `desired` (slides along obstacles, climbs
   * steps, snaps to ground), queue it as the body's next translation, and return
   * the applied movement + whether the character ended up grounded.
   */
  moveCharacter(controller: CharacterController, body: number, collider: number, desired: Vec3): CharacterMove {
    const rigidBody = this.world.getRigidBody(body);
    controller.computeColliderMovement(this.world.getCollider(collider), {
      x: desired[0],
      y: desired[1],
      z: desired[2],
    });
    const m = controller.computedMovement();
    const p = rigidBody.translation();
    rigidBody.setNextKinematicTranslation({ x: p.x + m.x, y: p.y + m.y, z: p.z + m.z });

    return { grounded: controller.computedGrounded(), movement: [m.x, m.y, m.z] };
  }

  /** Re-park a vehicle: engine off, wheels straight, parking brake on all wheels. */
  parkVehicle(controller: VehicleController): void {
    const count = controller.numWheels();
    for (let i = 0; i < count; i += 1) {
      controller.setWheelEngineForce(i, 0);
      controller.setWheelBrake(i, PARKING_BRAKE);
      controller.setWheelSteering(i, 0);
    }
  }

  readBody(handle: number): BodyTransform {
    const body = this.world.getRigidBody(handle);
    const t = body.translation();
    const r = body.rotation();

    return { position: [t.x, t.y, t.z], quaternion: [r.x, r.y, r.z, r.w] };
  }

  /** Remove static bodies (and their colliders) by handle — e.g. when a cell unloads. */
  removeBodies(handles: readonly number[]): void {
    for (const handle of handles) {
      this.world.removeRigidBody(this.world.getRigidBody(handle));
    }
  }

  /**
   * Remove a raycast vehicle's controller so it is no longer stepped — call this
   * BEFORE removing its chassis body, or {@link step}'s `updateVehicle` panics on
   * the orphaned controller.
   */
  removeVehicle(controller: VehicleController): void {
    const index = this.vehicles.indexOf(controller);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
    this.world.removeVehicleController(controller);
  }

  /**
   * Seed a small backward planar velocity (along −forward of `heading`) so reverse
   * engages from a dead stop — the raycast controller won't start reverse from rest
   * on its own. Keeps the current vertical velocity.
   */
  seedReverse(handle: number, heading: number, speed: number): void {
    const body = this.world.getRigidBody(handle);
    const v = body.linvel();
    body.setLinvel({ x: Math.sin(heading) * speed, y: -Math.cos(heading) * speed, z: v.z }, true);
  }

  /** Enable/disable a collider (e.g. the player's while seated, so the car doesn't collide with it). */
  setColliderEnabled(handle: number, enabled: boolean): void {
    this.world.getCollider(handle).setEnabled(enabled);
  }

  /** Make a collider a sensor (detected but applies no contact force) or solid again. */
  setColliderSensor(handle: number, sensor: boolean): void {
    this.world.getCollider(handle).setSensor(sensor);
  }

  /** Set a body's linear velocity (Z-up). */
  setLinvel(handle: number, velocity: Vec3): void {
    this.world.getRigidBody(handle).setLinvel({ x: velocity[0], y: velocity[1], z: velocity[2] }, true);
  }

  /**
   * Apply per-frame driving controls: total `engineForce` and total `brake` each
   * split across all wheels (4WD), and `steer` (rad) on the front wheels.
   */
  setVehicleControls(
    controller: VehicleController,
    wheels: readonly { front: boolean }[],
    engineForce: number,
    brake: number,
    steer: number,
  ): void {
    const count = wheels.length || 1;
    const perEngine = engineForce / count;
    const perBrake = brake / count;
    wheels.forEach((wheel, i) => {
      controller.setWheelEngineForce(i, perEngine);
      controller.setWheelBrake(i, perBrake);
      controller.setWheelSteering(i, wheel.front ? steer : 0);
    });
  }

  step(dt: number): void {
    this.world.timestep = dt;
    for (const vehicle of this.vehicles) {
      vehicle.updateVehicle(dt); // writes the chassis velocity from suspension/engine before the step
    }
    this.world.step(this.events);
    this.events.drainContactForceEvents((event) => {
      const c1 = this.world.getCollider(event.collider1());
      const c2 = this.world.getCollider(event.collider2());
      let point: null | Vec3 = null;
      this.world.contactPair(c1, c2, (manifold) => {
        if (manifold.numSolverContacts() > 0) {
          const p = manifold.solverContactPoint(0); // world-space contact point
          point = [p.x, p.y, p.z];
        }
      });
      this.impacts.push({
        bodyA: c1.parent()?.handle ?? null,
        bodyB: c2.parent()?.handle ?? null,
        force: event.maxForceMagnitude(),
        point,
      });
    });
  }

  /** Drain the impacts collected since the last call (vehicle collision damage reads these). */
  takeImpacts(): readonly Impact[] {
    const impacts = this.impacts;
    this.impacts = [];

    return impacts;
  }

  /** Immediately move a body to a world position (Z-up) — e.g. seating the player in a car. */
  teleport(handle: number, position: Vec3): void {
    const body = this.world.getRigidBody(handle);
    const p = { x: position[0], y: position[1], z: position[2] };
    body.setTranslation(p, true);
    // Match the kinematic target so the next step doesn't pull the body back (no jitter).
    body.setNextKinematicTranslation(p);
  }

  /** Signed forward speed (units/s) of a raycast vehicle (+ = forward). */
  vehicleSpeed(controller: VehicleController): number {
    return controller.currentVehicleSpeed();
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

  /**
   * Build the dynamic chassis collider from the COL's convex primitives (spheres +
   * boxes), giving each shape an **equal** share of `mass` (not volume-weighted) so a
   * single oversized COL sphere — e.g. the camper's big front sphere — can't drag the
   * centre of mass high/forward and make the car wobble. Each shape keeps its own
   * shape-based inertia (realistic, unlike a single box approximation). Falls back to a
   * convex hull (then a box) of the vertices when a COL has no primitives. The COL
   * trimesh is omitted (it can't collide with the static world trimesh).
   */
  private addVehicleHull(body: RapierBody, shape: ModelColliders['shape'] | null, mass: number): void {
    const spheres = (shape?.spheres ?? []).filter((sphere) => sphere.radius > 0);
    const boxes = (shape?.boxes ?? []).filter(
      (box) => box.max[0] > box.min[0] && box.max[1] > box.min[1] && box.max[2] > box.min[2],
    );
    if (spheres.length + boxes.length === 0) {
      const vertices = shape?.vertices ?? new Float32Array();
      const hull = this.rapier.ColliderDesc.convexHull(vertices) ?? this.boxHull(vertices);
      this.world.createCollider(
        hull.setMass(mass).setFriction(CHASSIS_FRICTION).setCollisionGroups(VEHICLE_GROUPS),
        body,
      );

      return;
    }

    const perShape = mass / (spheres.length + boxes.length); // equal share → COM = mean of centres
    for (const sphere of spheres) {
      const [x, y, z] = sphere.center;
      const desc = this.rapier.ColliderDesc.ball(sphere.radius).setTranslation(x, y, z);
      this.world.createCollider(this.vehicleCollider(desc, perShape), body);
    }
    for (const box of boxes) {
      const hx = (box.max[0] - box.min[0]) / 2;
      const hy = (box.max[1] - box.min[1]) / 2;
      const hz = (box.max[2] - box.min[2]) / 2;
      const cx = (box.max[0] + box.min[0]) / 2;
      const cy = (box.max[1] + box.min[1]) / 2;
      const cz = (box.max[2] + box.min[2]) / 2;
      const desc = this.rapier.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
      this.world.createCollider(this.vehicleCollider(desc, perShape), body);
    }
  }

  /** A cuboid hull (half-extents from the vertices' AABB) — fallback when convexHull fails. */
  private boxHull(vertices: Float32Array): ReturnType<Rapier['ColliderDesc']['cuboid']> {
    let hx = 0.5;
    let hy = 0.5;
    let hz = 0.5;
    for (let i = 0; i + 2 < vertices.length; i += 3) {
      hx = Math.max(hx, Math.abs(vertices[i]));
      hy = Math.max(hy, Math.abs(vertices[i + 1]));
      hz = Math.max(hz, Math.abs(vertices[i + 2]));
    }

    return this.rapier.ColliderDesc.cuboid(hx, hy, hz);
  }

  /**
   * A chassis collider desc: mass + friction + vehicle collision group, a little restitution
   * (bounce off walls), and contact-force events (so collisions report impacts for damage).
   */
  private vehicleCollider(
    desc: ReturnType<Rapier['ColliderDesc']['ball']>,
    mass: number,
  ): ReturnType<Rapier['ColliderDesc']['ball']> {
    return desc
      .setMass(mass)
      .setFriction(CHASSIS_FRICTION)
      .setCollisionGroups(VEHICLE_GROUPS)
      .setRestitution(CHASSIS_RESTITUTION)
      .setRestitutionCombineRule(this.rapier.CoefficientCombineRule.Max)
      .setActiveEvents(this.rapier.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(CONTACT_FORCE_THRESHOLD);
  }
}
