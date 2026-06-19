/**
 * Aggregates per-chunk byte progress into the global snapshot the loader emits (pure). Seeded with the
 * chunks of the active `load()` set; cached chunks are marked complete immediately, downloading ones
 * update incrementally.
 */
import type { ProgressSnapshot } from './types';

export class ProgressTracker {
  private readonly loaded = new Map<string, number>();
  private readonly totals = new Map<string, number>();

  constructor(chunks: readonly { bytes: number; file: string }[]) {
    for (const chunk of chunks) {
      this.totals.set(chunk.file, chunk.bytes);
      this.loaded.set(chunk.file, 0);
    }
  }

  /** Mark a chunk fully loaded (cached or finished). No-op for an unknown file. */
  complete(file: string): void {
    const total = this.totals.get(file);
    if (total !== undefined) {
      this.loaded.set(file, total);
    }
  }

  /** Record a chunk's loaded byte count (clamped to its total). No-op for an unknown file. */
  set(file: string, loadedBytes: number): void {
    const total = this.totals.get(file);
    if (total !== undefined) {
      this.loaded.set(file, Math.min(loadedBytes, total));
    }
  }

  /** Current global progress across all tracked chunks. */
  snapshot(): ProgressSnapshot {
    let loadedBytes = 0;
    let loadedChunks = 0;
    let totalBytes = 0;
    for (const [file, total] of this.totals) {
      const got = this.loaded.get(file) ?? 0;
      loadedBytes += got;
      totalBytes += total;
      if (got >= total) {
        loadedChunks += 1;
      }
    }

    return { loadedBytes, loadedChunks, totalBytes, totalChunks: this.totals.size };
  }
}
