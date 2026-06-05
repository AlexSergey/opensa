import { createWorld, type World } from 'bitecs';

/** The shared bitECS world handle for dynamic entities (player, later NPCs). */
export type EcsWorld = World;

export function createEcsWorld(): EcsWorld {
  return createWorld();
}
