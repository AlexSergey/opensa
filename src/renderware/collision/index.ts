// Collision (COL) index over the WIMG archive: parse every `.col` library into a
// name → collision-model map, and bind it to placed objects per region.
export { buildColliders, type ColliderOptions, type RegionColliders } from './build-colliders';
export { buildCollisionIndex, type CollisionIndex, getCollision } from './collision-index';
