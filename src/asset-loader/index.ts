/** Asset loader (plan 049): manifest-driven, cached, on-demand chunk download. Public surface. */
export { AssetLoader, type AssetLoaderConfig } from './asset-loader';
export { Emitter, type Listener } from './emitter';
export { allChunks, chunkUrl, chunkUrls, GROUP_NAMES, manifestDir, parseManifest } from './manifest';
export type {
  AssetLoaderEvents,
  AssetSink,
  ChunkInfo,
  ChunkStatus,
  GroupChunk,
  GroupName,
  Manifest,
  ProgressSnapshot,
} from './types';
