/**
 * In-memory Virtual File System (plan 050): receives the loader's chunk zips (`AssetSink`), unzips them
 * with fflate, and serves every entry by name behind `AssetFileSystem`. Keys are the names as packed —
 * bare for model-archive files (`cj.dff`, `la.col`, `lae.ipl`) and relative paths for loose files
 * (`data/gta.dat`, `text/american.gxt`). `verify` cross-checks the result against the manifest.
 */
import { unzipSync } from 'fflate';

import type { AssetSink, GroupName, Manifest } from '../asset-loader';
import type { AssetFileSystem } from '../renderware/archive';

import { manifestTotals, verifyTotals } from './verify';

export class Vfs implements AssetFileSystem, AssetSink {
  get names(): string[] {
    return [...this.files.keys()];
  }
  private chunkCount = 0;
  private entryCount = 0;

  private readonly files = new Map<string, Uint8Array>();

  /** Unzip a delivered chunk and index its entries (loader hands these in via the sink). */
  addChunk(_group: GroupName, zipBytes: Uint8Array): void {
    const entries = unzipSync(zipBytes);
    for (const name of Object.keys(entries)) {
      this.files.set(name, entries[name]);
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
