import type { Vec3 } from '../game';

// CJ's house on Grove Street, Ganton (GTA SA world coords, Z-up).
export const GANTON_CJ_HOME: Vec3 = [2495, -1687, 13];

// Player spawn: on the open cul-de-sac in front of CJ's house (moved north off
// the house), raised so it drops onto the surface once physics is on (Z-up).
// Tune against the real ground / lot centre.
export const PLAYER_SPAWN: Vec3 = [2495, -1675, 16];

/** Whole-map load: origin centre + an unbounded radius. */
export const FULL_MAP_CENTER: Vec3 = [0, 0, 0];

/** Load radius around Ganton, in GTA units. */
export const GANTON_RADIUS = 400;
