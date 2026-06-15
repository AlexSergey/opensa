/**
 * The asset loader (plan 049): fetches the build manifest, downloads chunk zips on demand with a small
 * concurrency limit, caches each in Cache Storage (skipping cached ones), invalidates stale chunks, and
 * pushes every ready chunk's RAW bytes to the sink (the VFS). Progress goes out on `events`. Browser-only
 * (fetch streaming + Cache Storage) — exercised on the Playwright e2e lane.
 */
import type { AssetLoaderEvents, AssetSink, GroupChunk, GroupName, Manifest } from './types';

import { CacheStore } from './cache-store';
import { Emitter } from './emitter';
import { staleKeys } from './invalidate';
import { allChunks, chunkUrl, chunkUrls, GROUP_NAMES, manifestDir, parseManifest } from './manifest';
import { ProgressTracker } from './progress';

export interface AssetLoaderConfig {
  /** Cache Storage bucket name (default `opensa-assets`). */
  cacheName?: string;
  /** Parallel chunk downloads (default 4). */
  concurrency?: number;
  /** Full URL to `manifest.json` (the caller knows game + version). */
  manifestUrl: string;
  /** Where ready chunk bytes go — the VFS. Optional so the loader runs/tests standalone. */
  sink?: AssetSink;
  /** Verify each chunk's SHA-1 against the manifest (default false; size is always checked). */
  verifyHash?: boolean;
}

export class AssetLoader {
  readonly events = new Emitter<AssetLoaderEvents>();

  private readonly cache: CacheStore;
  private readonly concurrency: number;
  private readonly config: AssetLoaderConfig;
  private dir = '';
  private manifest: Manifest | null = null;

  constructor(config: AssetLoaderConfig) {
    this.config = config;
    this.cache = new CacheStore(config.cacheName ?? 'opensa-assets');
    this.concurrency = config.concurrency ?? 4;
  }

  /** Fetch + parse the manifest (always fresh), then evict cached chunks it no longer references. */
  async init(): Promise<Manifest> {
    const response = await fetch(this.config.manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`manifest fetch failed: ${response.status}`);
    }
    const manifest = parseManifest(await response.json());
    this.manifest = manifest;
    this.dir = manifestDir(this.config.manifestUrl);

    const stale = staleKeys(await this.cache.keys(), chunkUrls(manifest, this.dir));
    await Promise.all(stale.map((url) => this.cache.delete(url)));

    return manifest;
  }

  /** Ensure the given groups' chunks are present (download missing, skip cached). Default: all groups. */
  async load(groups: readonly GroupName[] = GROUP_NAMES): Promise<void> {
    const manifest = this.manifest ?? (await this.init());
    const chunks = allChunks(manifest).filter((chunk) => groups.includes(chunk.group));
    const tracker = new ProgressTracker(chunks);
    this.events.emit('progress', tracker.snapshot());

    await runWithConcurrency(chunks, this.concurrency, (chunk) => this.fetchChunk(chunk, tracker));
  }

  private async deliver(chunk: GroupChunk, bytes: Uint8Array): Promise<void> {
    this.events.emit('chunkReady', { bytes, file: chunk.file, group: chunk.group });
    await this.config.sink?.addChunk(chunk.group, bytes);
  }

  private async download(url: string, chunk: GroupChunk, tracker: ProgressTracker): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`chunk fetch failed: ${chunk.file} (${response.status})`);
    }
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parts.push(value);
      received += value.length;
      tracker.set(chunk.file, received);
      this.emitChunk(chunk, 'downloading', received);
      this.events.emit('progress', tracker.snapshot());
    }
    const bytes = concat(parts, received);
    await verify(bytes, chunk, this.config.verifyHash ?? false);

    return bytes;
  }

  private emitChunk(chunk: GroupChunk, status: AssetLoaderEvents['chunk']['status'], loadedBytes: number): void {
    this.events.emit('chunk', { file: chunk.file, group: chunk.group, loadedBytes, status, totalBytes: chunk.bytes });
  }

  private async fetchChunk(chunk: GroupChunk, tracker: ProgressTracker): Promise<void> {
    const url = chunkUrl(this.dir, chunk);
    try {
      const cached = await this.cache.match(url);
      if (cached) {
        tracker.complete(chunk.file);
        this.emitChunk(chunk, 'cached', chunk.bytes);
        this.events.emit('progress', tracker.snapshot());
        await this.deliver(chunk, cached);

        return;
      }
      const bytes = await this.download(url, chunk, tracker);
      await this.cache.put(url, bytes);
      tracker.complete(chunk.file);
      this.emitChunk(chunk, 'done', chunk.bytes);
      this.events.emit('progress', tracker.snapshot());
      await this.deliver(chunk, bytes);
    } catch (error) {
      this.emitChunk(chunk, 'error', 0);
      this.events.emit('error', { error, file: chunk.file });
      throw error;
    }
  }
}

/** Concatenate streamed parts into one buffer of known total length. */
function concat(parts: readonly Uint8Array[], total: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runner = async (): Promise<void> => {
    let item = queue.shift();
    while (item !== undefined) {
      await worker(item);
      item = queue.shift();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, runner));
}

/** Integrity check: byte length always, SHA-1 (12-hex prefix, matching the build) when requested. */
async function verify(bytes: Uint8Array<ArrayBuffer>, chunk: GroupChunk, verifyHash: boolean): Promise<void> {
  if (bytes.length !== chunk.bytes) {
    throw new Error(`chunk ${chunk.file} size mismatch: ${bytes.length} != ${chunk.bytes}`);
  }
  if (!verifyHash) {
    return;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hex.slice(0, chunk.hash.length) !== chunk.hash) {
    throw new Error(`chunk ${chunk.file} hash mismatch`);
  }
}
