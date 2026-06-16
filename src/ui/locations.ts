import type { Vec3 } from '../game';
import type { GameType } from '../game-config';

// CJ's house on Grove Street, Ganton (GTA SA world coords, Z-up).
export const GANTON_CJ_HOME: Vec3 = [2495, -1687, 13];

// Player spawn per game variant (GTA SA world coords, Z-up) — raised so the player drops onto the
// surface once physics is on. Tune against the real ground / lot centre.
export const PLAYER_SPAWN: Record<GameType, Vec3> = {
  anderius: [-904.7, 1430.1, 136.5],
  carcer: [401.9, 795.4, 20.5],
  original: [2495, 795.4, 20.5],
};

/** Radius (GTA units) the collision zone is built for around the spawn. */
export const GANTON_RADIUS = 400;
