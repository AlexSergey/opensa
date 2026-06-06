// Public API for the RenderWare (GTA San Andreas) asset loaders.

// IMG archive + asset resolution
export * from './archive';

// Collision (COL) index over the archive
export * from './collision';

// Framework-agnostic map resolution + region instancing
export * from './map';
// Parser layer (renderer-agnostic): binary RW geometry + collision + text map definitions.
export { parseColLibrary } from './parsers/binary/col';
export * from './parsers/binary/col-types';
export { parseDff } from './parsers/binary/dff';
export { parseTxd } from './parsers/binary/txd';
export * from './parsers/binary/types';

export * from './parsers/text';

// three.js adapter layer
export { buildClump, buildClumpParts, type RenderPart } from './three/build-clump';
export { buildCollisionWireframe } from './three/build-col-wireframe';
export { buildSkinnedClump, type SkinnedClump } from './three/build-skinned-clump';
export { buildTextureMap } from './three/build-texture';
export { DFFLoader } from './three/dff-loader';
export { type TextureDictionary, TXDLoader } from './three/txd-loader';
