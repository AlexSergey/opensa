/**
 * Shared types for the asset loaders (plans 049 + 053). A loader resolves the game's assets into the VFS;
 * `AssetFetchLoader` downloads manifest-listed chunk zips, `AssetLocalLoader` reads a raw install folder.
 * Both expose the same {@link AssetLoader} contract and emit the same events, so boot stays loader-agnostic.
 */
import type { Emitter } from './emitter';

/** The contract the boot flow drives — implemented by every loader (fetch / local). */
export interface AssetLoader {
  readonly events: Emitter<AssetLoaderEvents>;
  /** Resolve the asset set (fetch+parse manifest / prompt+scan the install) and return its manifest. */
  init(): Promise<Manifest>;
  /** Make the given groups' assets present in the VFS sink (download / read). Default: all groups. */
  load(groups?: readonly GroupName[]): Promise<void>;
  /**
   * Optional: run anything that needs a **user gesture** before loading — the local loader prompts for the
   * install folder here. A loader that defines `prepare` must be `ready()` before {@link init}/{@link load}.
   */
  prepare?(): Promise<void>;
  /** Optional: `true` once {@link prepare}/{@link restore} have made the loader usable. Absent ⇒ always ready. */
  ready?(): boolean;
  /**
   * Optional: boot-time restore with NO user gesture — the local loader reloads its remembered install folder
   * so {@link prepare} can skip or shorten the prompt (the picker must be the gesture's first await). No-op
   * for the fetch loader.
   */
  restore?(): Promise<void>;
}

/** Event payloads emitted by the loader (global progress + per-chunk lifecycle). */
export interface AssetLoaderEvents {
  chunk: { file: string; group: GroupName; loadedBytes: number; status: ChunkStatus; totalBytes: number };
  chunkReady: { bytes: Uint8Array; file: string; group: GroupName };
  error: { error: unknown; file: string };
  progress: ProgressSnapshot;
}

/** Which loader the build selects (`VITE_ASSET_LOADER`, default `fetch`). */
export type AssetLoaderKind = 'fetch' | 'local';

/**
 * Where the loader pushes each ready chunk's RAW zip bytes. Implemented by the Virtual File System
 * (next plan): the VFS unzips + indexes the chunk — the loader never unzips.
 */
export interface AssetSink {
  /** `file` is the chunk's content-hashed name — lets the sink ignore a re-delivered chunk (retry/StrictMode). */
  addChunk(group: GroupName, file: string, zipBytes: Uint8Array): Promise<void> | void;
  /**
   * Index pre-unzipped files under a synthetic chunk id (the local loader's raw ingest — no zip). Idempotent
   * on `chunkId` (re-ingest is a no-op), so it accounts for verify exactly like {@link addChunk}.
   */
  addFiles(chunkId: string, entries: Iterable<readonly [string, Uint8Array]>): Promise<void> | void;
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

/** The build manifest at `static/games/<game>-<version>/manifest.json`. */
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
