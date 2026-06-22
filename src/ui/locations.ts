import type { Vec3 } from '../game';
import type { GameType } from '../game-config';

// Player spawn per game variant (GTA SA world coords, Z-up) — raised so the player drops onto the surface
// once physics is on. The single source of truth for "where the player starts": it also seeds the initial
// collision zone (`loadGame` centres on it). Tune against the real ground / lot centre.
export const PLAYER_SPAWN: Record<GameType, Vec3> = {
  anderius: [-904.7, 1430.1, 136.5],
  carcer: [401.9, 795.4, 20.5],
  gostown: [1472.1, -1057.3, 630.4],
  original: [2495, -1675, 16],
  'original-extend': [2495, -1675, 16],
};

/** Radius (GTA units) the initial collision zone is built for around the spawn. */
export const SPAWN_COLLISION_RADIUS = 400;
