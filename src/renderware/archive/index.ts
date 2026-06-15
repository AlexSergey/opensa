export { getClump, getIfp, getTextures, resolveTxdChain, setTxdParents } from './asset-cache';
// IMG archive (WIMG) + asset resolution: download, in-memory unpack, model/texture
// caching, model-instancing key, and gta.dat path → URL helpers.
export type { AssetFileSystem } from './asset-fs';
export { buildArchiveBuffer, buildVer2Buffer, type ImgArchive, loadArchive, openArchive } from './img-archive';
export { modelKey } from './model-key';
export { datChildUrl, iplBasename, normalizeDatPath, standaloneIplUrl, streamIplUrl } from './resolve-paths';
