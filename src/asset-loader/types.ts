/**
 * Shared types for the asset loader (plan 049). The loader fetches the build manifest, downloads the
 * chunk zips on demand, caches them, and hands each ready chunk's RAW bytes to a sink (the VFS).
 */

/** Event payloads emitted by the loader (global progress + per-chunk lifecycle). */
export interface AssetLoaderEvents {
  chunk: { file: string; group: GroupName; loadedBytes: number; status: ChunkStatus; totalBytes: number };
  chunkReady: { bytes: Uint8Array; file: string; group: GroupName };
  error: { error: unknown; file: string };
  progress: ProgressSnapshot;
}

/**
 * Where the loader pushes each ready chunk's RAW zip bytes. Implemented by the Virtual File System
 * (next plan): the VFS unzips + indexes the chunk — the loader never unzips.
 */
export interface AssetSink {
  /** `file` is the chunk's content-hashed name — lets the sink ignore a re-delivered chunk (retry/StrictMode). */
  addChunk(group: GroupName, file: string, zipBytes: Uint8Array): Promise<void> | void;
}

/** One chunk as recorded in `manifest.json` (mirrors the build's `ChunkInfo`). */
export interface ChunkInfo {
  /** Compressed chunk size in bytes (the download size). */
  bytes: number;
  /** Number of files packed in the chunk. */
  entries: number;
  /** Content-hashed file name, e.g. `textures-2a7909a5bfec.zip`. */
  file: string;
  /** Content hash (also embedded in `file`) for integrity checks. */
  hash: string;
}

/** Per-chunk lifecycle status reported on the `chunk` event. */
export type ChunkStatus = 'cached' | 'done' | 'downloading' | 'error';

/** A chunk flattened out of the manifest with its owning group. */
export interface GroupChunk extends ChunkInfo {
  group: GroupName;
}

/** A build group — the three partition buckets the build emits (see scripts/build-game.ts). */
export type GroupName = 'models' | 'priority' | 'textures';

/** The build manifest at `static/<game>-<version>/manifest.json`. */
export interface Manifest {
  chunks: Record<GroupName, ChunkInfo[]>;
  game: string;
  version: string;
}

/** Global download progress for the active `load()` set. */
export interface ProgressSnapshot {
  loadedBytes: number;
  loadedChunks: number;
  totalBytes: number;
  totalChunks: number;
}
