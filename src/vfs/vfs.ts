/**
 * In-memory Virtual File System (plan 050): receives the loader's chunk zips (`AssetSink`), unzips them
 * with fflate, and serves every entry by name behind `AssetFileSystem`. Keys are the names as packed —
 * bare for model-archive files (`cj.dff`, `la.col`, `lae.ipl`) and relative paths for loose files
 * (`data/gta.dat`, `text/american.gxt`). `verify` cross-checks the result against the manifest.
 */
import { unzipSync } from 'fflate';

import type { AssetSink, GroupName, Manifest } from '../loaders';
import type { AssetFileSystem } from '../renderware/archive';

import { manifestTotals, verifyTotals } from './verify';

export class Vfs implements AssetFileSystem, AssetSink {
  get names(): string[] {
    return [...this.files.keys()];
  }
  private readonly addedChunks = new Set<string>();
  private chunkCount = 0;
  private entryCount = 0;

  private readonly files = new Map<string, Uint8Array>();

  /** Unzip a delivered chunk and index its entries. Idempotent — a re-delivered chunk (retry/StrictMode)
   *  is ignored, so the verify counts stay correct. */
  addChunk(_group: GroupName, file: string, zipBytes: Uint8Array): void {
    if (this.addedChunks.has(file)) {
      return;
    }
    this.addedChunks.add(file);
    const entries = unzipSync(zipBytes);
    for (const name of Object.keys(entries)) {
      this.files.set(name, entries[name]);
      this.entryCount += 1;
    }
    this.chunkCount += 1;
  }

  /** Raw ingest (local loader): index already-unzipped files under a synthetic chunk id. Idempotent on
   *  `chunkId`, accounting like {@link addChunk} so `verify` works against a synthesised manifest. */
  addFiles(chunkId: string, entries: Iterable<readonly [string, Uint8Array]>): void {
    if (this.addedChunks.has(chunkId)) {
      return;
    }
    this.addedChunks.add(chunkId);
    for (const [name, bytes] of entries) {
      this.files.set(name, bytes);
      this.entryCount += 1;
    }
    this.chunkCount += 1;
  }

  get(name: string): ArrayBuffer | null {
    const bytes = this.files.get(name);

    return bytes ? new Uint8Array(bytes).buffer : null;
  }

  getText(name: string): null | string {
    const bytes = this.files.get(name);

    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  has(name: string): boolean {
    return this.files.has(name);
  }

  /** Problems vs the manifest (empty = every chunk delivered and every entry present). */
  verify(manifest: Manifest): string[] {
    return verifyTotals(manifestTotals(manifest), { chunks: this.chunkCount, entries: this.entryCount });
  }
}
