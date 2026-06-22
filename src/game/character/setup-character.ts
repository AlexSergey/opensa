import { addComponent, addEntity } from 'bitecs';
import { type Bone, Box3, type Object3D, type Skeleton, Vector3 } from 'three';

import type { EcsWorld } from '../ecs/world';
import type { Game } from '../game';
import type { InputState } from '../input';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { PlayerControlled, RigidBody, Transform, Velocity } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { Keyboard, KeyboardSource } from '../input';
import { PhysicsWorld } from '../physics/physics-world';
import { PhysicsSystem } from '../physics/physics.system';
import { initRapier } from '../physics/rapier';
import { CharacterControllerSystem } from './character-controller.system';
import { RenderSyncSystem } from './render-sync.system';

const MIN_HALF_EXTENT = 0.1;

/** Handles created for the player, extended by later systems (control). */
export interface CharacterContext {
  /** The Rapier rigid-body handle of the player (e.g. for reading velocity/grounded). */
  bodyHandle: number;
  /** The player mesh's bones keyed by name (empty if not skinned), for the animation manager. */
  bonesByName: Map<string, Bone>;
  /** The player controller system — e.g. for scripted auto-run (`runTo`). */
  controllerSystem: CharacterControllerSystem;
  /** Player collision-box half-extents (the controller's grounding half-height is `[2]`). */
  halfExtents: Vec3;
  /** Device-agnostic player input the systems read (keyboard today; pluggable sources — plan 055). */
  input: InputState;
  physics: PhysicsWorld;
  /**
   * Place the player at a world point (Z-up) + sync its Transform this frame (no render lag).
   * `moveBody` (default true) also teleports the physics body; pass false to move only the
   * rendered Transform (e.g. while riding in a car, so the kinematic body doesn't shove the car).
   */
  placePlayer: (position: Vec3, moveBody?: boolean) => void;
  /** The player's collider handle (e.g. to disable it while seated in a car). */
  playerCollider: number;
  playerEid: number;
  renderRefs: Map<number, Object3D>;
  /** The player mesh's skeleton (null if not skinned). */
  skeleton: null | Skeleton;
  /** The player's world position (GTA Z-up), e.g. for streaming to centre on. */
  viewOf: () => Vec3;
  world: EcsWorld;
}

/** Options for {@link setupCharacter}. */
export interface SetupCharacterOptions {
  /** Bones keyed by name, exposed on the context for the animation manager. */
  bonesByName?: Map<string, Bone>;
  /** Human-sized collision box; defaults to the mesh's bounding box. */
  halfExtents?: Vec3;
  /** Skeleton, exposed on the context for the animation manager. */
  skeleton?: null | Skeleton;
}

/**
 * Create the bitECS world + player entity, a Rapier **kinematic capsule** + its
 * character controller (sized from `options.halfExtents`, else the mesh bbox), and
 * register the physics + render systems. Everything is GTA Z-up; the mesh is added
 * under the engine's `entityRoot`. Returns the character handles (incl. the
 * skeleton/named bones for the animation manager).
 */
export async function setupCharacter(
  game: Game,
  player: Object3D,
  spawn: Vec3,
  options: SetupCharacterOptions = {},
): Promise<CharacterContext> {
  const world = createEcsWorld();
  const renderRefs = new Map<number, Object3D>();

  const playerEid = addEntity(world);
  addComponent(world, playerEid, Transform);
  addComponent(world, playerEid, PlayerControlled);
  addComponent(world, playerEid, RigidBody);
  addComponent(world, playerEid, Velocity);
  Transform.x[playerEid] = spawn[0];
  Transform.y[playerEid] = spawn[1];
  Transform.z[playerEid] = spawn[2];
  Transform.qx[playerEid] = 0;
  Transform.qy[playerEid] = 0;
  Transform.qz[playerEid] = 0;
  Transform.qw[playerEid] = 1;
  Velocity.x[playerEid] = 0;
  Velocity.y[playerEid] = 0;
  Velocity.z[playerEid] = 0;
  Velocity.grounded[playerEid] = 0;

  // Capsule from the human box: radius from the planar half-extent, half-height of
  // the cylinder so the total (2·halfHeight + 2·radius) matches the box height.
  const extents = options.halfExtents ?? meshHalfExtents(player);
  const radius = Math.max(Math.min(extents[0], extents[1]), MIN_HALF_EXTENT);
  const halfHeight = Math.max(extents[2] - radius, MIN_HALF_EXTENT);

  const physics = new PhysicsWorld(await initRapier());
  const controller = physics.createCharacterController();
  // Map collision is streamed per cell (CollisionStreamingSystem, wired in the bootstrap).
  const capsule = physics.createKinematicCapsule(spawn, radius, halfHeight);
  RigidBody.handle[playerEid] = capsule.body;
  RigidBody.collider[playerEid] = capsule.collider;

  game.getEntityRoot().add(player);
  renderRefs.set(playerEid, player);

  const keyboard = new Keyboard();
  keyboard.start();

  const config = game.getConfig();
  // The systems read the game's combined InputState; the keyboard joins as a source (plan 055). The pointer
  // look/zoom source is already registered by the game; a touch overlay can add another later.
  game.addInputSource(new KeyboardSource(keyboard, config.controls));
  const input = game.getInput();
  const renderSync = new RenderSyncSystem(world, renderRefs);
  // Order matters: controller moves the capsule → physics steps → render syncs.
  const controllerSystem = new CharacterControllerSystem(world, physics, input, config, controller, game.getCamera());
  game.addSystem(controllerSystem);
  game.addSystem(new PhysicsSystem(world, physics, config));
  game.addSystem(renderSync);
  renderSync.update(); // place the mesh now so the immediate camera frame is correct
  game.setFollowTarget(player); // camera trails the player while playing

  const viewOf = (): Vec3 => [Transform.x[playerEid], Transform.y[playerEid], Transform.z[playerEid]];

  // Place the player at a world point and write its Transform now, so the rendered mesh/camera
  // match this frame (no one-tick lag). `moveBody` also teleports the kinematic body; while
  // riding in a car we pass false so the body never enters the car and shoves it.
  const placePlayer = (position: Vec3, moveBody = true): void => {
    if (moveBody) {
      physics.teleport(RigidBody.handle[playerEid], position);
    }
    Transform.x[playerEid] = position[0];
    Transform.y[playerEid] = position[1];
    Transform.z[playerEid] = position[2];
  };

  return {
    bodyHandle: RigidBody.handle[playerEid],
    bonesByName: options.bonesByName ?? new Map<string, Bone>(),
    controllerSystem,
    halfExtents: extents,
    input,
    physics,
    placePlayer,
    playerCollider: RigidBody.collider[playerEid],
    playerEid,
    renderRefs,
    skeleton: options.skeleton ?? null,
    viewOf,
    world,
  };
}

/** Half-extents of a mesh's world bounding box (fallback when none is given). */
function meshHalfExtents(object: Object3D): Vec3 {
  object.updateMatrixWorld(true);
  const size = new Box3().setFromObject(object).getSize(new Vector3());

  return [
    Math.max(size.x / 2, MIN_HALF_EXTENT),
    Math.max(size.y / 2, MIN_HALF_EXTENT),
    Math.max(size.z / 2, MIN_HALF_EXTENT),
  ];
}
