// Public API for the RenderWare (GTA San Andreas) asset loaders.

// IMG archive + asset resolution
export * from './archive';

// Framework-agnostic map resolution + region instancing
export * from './map';
// Parser layer (renderer-agnostic): binary RW geometry + text map definitions.
export { parseDff } from './parsers/binary/dff';
export { parseTxd } from './parsers/binary/txd';
export * from './parsers/binary/types';

export * from './parsers/text';

// three.js adapter layer
export { buildClump, buildClumpParts, type RenderPart } from './three/build-clump';
export { buildTextureMap } from './three/build-texture';
export { DFFLoader } from './three/dff-loader';
export { type TextureDictionary, TXDLoader } from './three/txd-loader';
