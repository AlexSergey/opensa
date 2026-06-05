import { addComponent, addEntity } from 'bitecs';
import { Box3, type Object3D, Vector3 } from 'three';

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
  keyboard: Keyboard;
  physics: PhysicsWorld;
  playerEid: number;
  renderRefs: Map<number, Object3D>;
  world: EcsWorld;
}

/**
 * Create the bitECS world + player entity, a Rapier dynamic box body sized to the
 * mesh (with a temporary ground to land on), and register the physics + render
 * systems. Everything is GTA Z-up; the mesh is added under the engine's
 * `entityRoot`. Returns handles later iterations extend (real colliders, control).
 */
export async function setupCharacter(game: Game, player: Object3D, spawn: Vec3): Promise<CharacterContext> {
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

  // Size the physics box to the loaded mesh (native Z-up, before it is parented).
  player.updateMatrixWorld(true);
  const size = new Box3().setFromObject(player).getSize(new Vector3());
  const halfExtents: Vec3 = [
    Math.max(size.x / 2, MIN_HALF_EXTENT),
    Math.max(size.y / 2, MIN_HALF_EXTENT),
    Math.max(size.z / 2, MIN_HALF_EXTENT),
  ];

  const physics = new PhysicsWorld(await initRapier());
  // Real map collision for the current region (the cube lands on the actual lot).
  await game.loadColliders();
  physics.createStaticColliders(game.getCollisionWorld().models);
  RigidBody.handle[playerEid] = physics.createCharacterBody(spawn, halfExtents);

  game.getEntityRoot().add(player);
  renderRefs.set(playerEid, player);

  const keyboard = new Keyboard();
  keyboard.start();

  const config = game.getConfig();
  const renderSync = new RenderSyncSystem(world, renderRefs);
  // Order matters: controller sets velocity → physics steps → render syncs.
  game.addSystem(new CharacterControllerSystem(world, physics, keyboard, config, halfExtents[2], game.getCamera()));
  game.addSystem(new PhysicsSystem(world, physics, config));
  game.addSystem(renderSync);
  renderSync.update(); // place the mesh now so the immediate camera frame is correct
  game.setFollowTarget(player); // camera trails the player while playing

  return { keyboard, physics, playerEid, renderRefs, world };
}
