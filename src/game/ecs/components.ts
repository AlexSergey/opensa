/**
 * bitECS components for dynamic entities.
 *
 * bitECS 0.4 stores no data itself — a component is a plain Structure-of-Arrays
 * object indexed by entity id; membership is tracked by `addComponent`/`query`.
 * Values are GTA Z-up (physics + ECS run in Z-up; the −90°X is display-only).
 */

/** Tag: the entity the local player controls. */
export const PlayerControlled = {};

/** Link to a Rapier rigid body, by its integer handle. */
export const RigidBody = {
  handle: [] as number[],
};

/** World position (x,y,z) + orientation quaternion (qx,qy,qz,qw). */
export const Transform = {
  qw: [] as number[],
  qx: [] as number[],
  qy: [] as number[],
  qz: [] as number[],
  x: [] as number[],
  y: [] as number[],
  z: [] as number[],
};
