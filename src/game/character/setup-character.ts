import { addComponent, addEntity } from 'bitecs';
import { type Bone, Box3, type Object3D, type Skeleton, Vector3 } from 'three';

import type { EcsWorld } from '../ecs/world';
import type { Game } from '../game';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { PlayerControlled, RigidBody, Transform } from '../ecs/components';
import { createEcsWorld } from '../ecs/world';
import { Keyboard } from '../input/keyboard';
import { PhysicsWorld } from '../physics/physics-world';
import { PhysicsSystem } from '../physics/physics.system';
import { initRapier } from '../physics/rapier';
import { CharacterControllerSystem } from './character-controller.system';
import { RenderSyncSystem } from './render-sync.system';

const MIN_HALF_EXTENT = 0.1;

/** Handles created for the player, extended by later systems (control). */
export interface CharacterContext {
  /** The player mesh's bones keyed by name (empty if not skinned), for the animation manager. */
  bonesByName: Map<string, Bone>;
  keyboard: Keyboard;
  physics: PhysicsWorld;
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
 * Create the bitECS world + player entity, a Rapier dynamic box body (a human-sized
 * box via `options.halfExtents`, else the mesh bbox), and register the physics +
 * render systems. Everything is GTA Z-up; the mesh is added under the engine's
 * `entityRoot`. Returns the character handles (incl. the skeleton/named bones for
 * the animation manager).
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
  Transform.x[playerEid] = spawn[0];
  Transform.y[playerEid] = spawn[1];
  Transform.z[playerEid] = spawn[2];
  Transform.qx[playerEid] = 0;
  Transform.qy[playerEid] = 0;
  Transform.qz[playerEid] = 0;
  Transform.qw[playerEid] = 1;

  // Use the caller's human-sized box when given (a character mesh's bbox includes
  // spread arms); otherwise size the box to the mesh (native Z-up, pre-parenting).
  const extents = options.halfExtents ?? meshHalfExtents(player);

  const physics = new PhysicsWorld(await initRapier());
  // Map collision is streamed per cell (CollisionStreamingSystem, wired in the bootstrap).
  RigidBody.handle[playerEid] = physics.createCharacterBody(spawn, extents);

  game.getEntityRoot().add(player);
  renderRefs.set(playerEid, player);

  const keyboard = new Keyboard();
  keyboard.start();

  const config = game.getConfig();
  const renderSync = new RenderSyncSystem(world, renderRefs);
  // Order matters: controller sets velocity → physics steps → render syncs.
  game.addSystem(new CharacterControllerSystem(world, physics, keyboard, config, extents[2], game.getCamera()));
  game.addSystem(new PhysicsSystem(world, physics, config));
  game.addSystem(renderSync);
  renderSync.update(); // place the mesh now so the immediate camera frame is correct
  game.setFollowTarget(player); // camera trails the player while playing

  const viewOf = (): Vec3 => [Transform.x[playerEid], Transform.y[playerEid], Transform.z[playerEid]];

  return {
    bonesByName: options.bonesByName ?? new Map<string, Bone>(),
    keyboard,
    physics,
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
