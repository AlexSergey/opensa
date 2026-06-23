/**
 * Asset loaders (plans 049 + 053): the boot flow drives one {@link AssetLoader} chosen per game by its
 * `assetLoader` — `fetch` (manifest + chunk download) or `local` (a user-picked raw install). Both fill the
 * same VFS, so everything downstream is loader-agnostic. Public surface of the loaders module.
 */
import type { AssetLoader, AssetLoaderKind, AssetSink } from './types';

import { AssetFetchLoader } from './asset-fetch-loader';
import { AssetLocalLoader } from './asset-local-loader';

export { AssetFetchLoader, type AssetFetchLoaderConfig } from './asset-fetch-loader';
export { AssetLocalLoader, type AssetLocalLoaderConfig } from './asset-local-loader';
export { Emitter, type Listener } from './emitter';
export { allChunks, chunkUrl, chunkUrls, CORE_GROUPS, GROUP_NAMES, manifestDir, parseManifest } from './manifest';
export type {
  AssetLoader,
  AssetLoaderEvents,
  AssetLoaderKind,
  AssetSink,
  ChunkInfo,
  ChunkStatus,
  GroupChunk,
  GroupName,
  Manifest,
  ProgressSnapshot,
} from './types';

/** Everything {@link createAssetLoader} needs for either loader; unused fields are ignored by the other. */
export interface CreateAssetLoaderConfig {
  /** Which loader to build for this game. */
  assetLoader: AssetLoaderKind;
  /** Build variant (e.g. `gostown`) — labels the local loader's synthesised manifest. */
  game: string;
  /** Full URL to `manifest.json` — used by the fetch loader. */
  manifestUrl: string;
  /** TEMPORARY: ped models to pull into the local loader's selection (from `peds.ide`). */
  peds?: readonly string[];
  /** Where resolved bytes go — the VFS. */
  sink?: AssetSink;
  /** TEMPORARY: vehicle models to pull into the local loader's selection (from `vehicles.ide`). */
  vehicles?: readonly string[];
  /** Build version string. */
  version: string;
}

/** Build the loader for a game's configured `assetLoader`. */
export function createAssetLoader(config: CreateAssetLoaderConfig): AssetLoader {
  if (config.assetLoader === 'local') {
    return new AssetLocalLoader({
      game: config.game,
      peds: config.peds,
      sink: config.sink,
      vehicles: config.vehicles,
      version: config.version,
    });
  }

  return new AssetFetchLoader({ manifestUrl: config.manifestUrl, sink: config.sink });
}
