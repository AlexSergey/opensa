/**
 * The asset-source read interface the game depends on (plan 050) — the swappable seam between the game
 * and however assets are stored. A superset of `ImgArchive` (`get`/`names`, which `asset-cache` already
 * consumes), plus `has`/`getText` for the loose data/text files. Lives here, next to `ImgArchive`, so the
 * renderware/game layers depend on the interface, not on the VFS implementation (`src/vfs`).
 */
import type { ImgArchive } from './img-archive';

export interface AssetFileSystem extends ImgArchive {
  /** UTF-8 text for a file (gta.dat, .ide, .ipl, .zon), or null when absent. (GXT is binary → use `get`.) */
  getText(name: string): null | string;
  /** Whether a file is present. */
  has(name: string): boolean;
}
