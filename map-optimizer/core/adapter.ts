import type { Asset, AssetRef, WriteResult } from './asset';

/**
 * Game-specific I/O behind one interface, so a new game = a new adapter and the core stays game-agnostic.
 * The core never imports a parser or a game format directly — only this. Implementations live under
 * `map-optimizer/adapters/<game>/`; they own all reading, writing and resolution of that game's assets.
 */
export interface GameAdapter {
  /** Optional persist/repack step after every asset is written (e.g. rebuild an IMG archive). */
  finalize?(outDir: string): Promise<void> | void;
  /** The game id this adapter handles. */
  readonly game: string;
  /** Load one referenced model into an editable {@link Asset} (IR + original bytes). */
  read(ref: AssetRef): Asset | Promise<Asset>;
  /** The unique map-referenced models to optimize (deduped by name). */
  resolve(): AssetRef[] | Promise<AssetRef[]>;
  /** Serialize an {@link Asset} back to game bytes — identity (original bytes) when `!asset.dirty`. */
  write(asset: Asset): Promise<WriteResult> | WriteResult;
}
