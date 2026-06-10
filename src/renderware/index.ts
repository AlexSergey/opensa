// Public API for the RenderWare (GTA San Andreas) asset loaders.

// IMG archive + asset resolution
export * from './archive';

// Collision (COL) index over the archive
export * from './collision';

// Framework-agnostic map resolution + region instancing
export * from './map';
// Parser layer (renderer-agnostic): binary RW geometry + collision + text map definitions.
export { parseColLibrary, parseDffCollision } from './parsers/binary/col';
export * from './parsers/binary/col-types';
export { parseDff } from './parsers/binary/dff';
export { gxtKeyHash, parseGxt } from './parsers/binary/gxt';
export { type IfpAnimation, type IfpBone, type IfpKeyframe, parseIfp } from './parsers/binary/ifp';
export { parseTxd } from './parsers/binary/txd';
export * from './parsers/binary/types';

export * from './parsers/text';

// three.js adapter layer
export { buildAnimationClip, type BuildAnimClipOptions } from './three/build-anim-clip';
export { buildClump, buildClumpLights, buildClumpParts, type ClumpLight, type RenderPart } from './three/build-clump';
export { buildCollisionWireframe } from './three/build-col-wireframe';
export { buildSkinnedClump, type SkinnedClump } from './three/build-skinned-clump';
export { buildTextureMap } from './three/build-texture';
export {
  buildVehicle,
  type BuiltDoor,
  type BuiltVehicle,
  type BuiltWheel,
  type VehicleOptions,
} from './three/build-vehicle';
export { buildWater, oceanFrame } from './three/build-water';
export { type CoronaEntry, coronaMaterial, GLOW_LAYER } from './three/corona';
export { DFFLoader } from './three/dff-loader';
export { nightFillRim, nightFillUniform } from './three/night-fill';
export { nightColorUniform } from './three/night-vertex-colors';
export { type TextureDictionary, TXDLoader } from './three/txd-loader';
