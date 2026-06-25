import type { Object3D } from 'three';

import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, WorldAdapter } from '../interfaces/world-adapter.interface';
import type { CellCoord } from './grid';

import { CellFader } from './fade';
import { cellDistanceSq, cellOf, cellsWithin } from './grid';

interface ManualSelection {
  cells: CellCoord[];
  lod: boolean;
}

/** What the streaming system needs from the world adapter. */
type StreamAdapter = Pick<WorldAdapter, 'cellSize' | 'loadCell'>;

/** Hysteresis dead-band as a fraction of the cell size: a cell keeps its current detail level until
 *  the view moves this much past the ring boundary, so straddling it doesn't flip-flop LOD↔HD. */
const HYSTERESIS = 0.25;

/**
 * Streams map cells in/out of the streaming root as the view moves. Two modes:
 * - **stream** (default): cells within `hdDrawDistance` render HD, cells within
 *   `lodDrawDistance` (beyond the HD ring) render LOD — the sectioned grid.
 * - **manual** (debug): renders only the cells set via {@link setManualCells} at
 *   one detail level. Active while `config.mapViewer` is on and a selection is set.
 *
 * **Seamless LOD↔HD swap:** the two detail levels of a cell are separate keys
 * (`cx,cy,hd` / `cx,cy,lod`). When a cell changes level the OLD level is kept
 * rendering until the NEW one has loaded and been added (the load handler then
 * removes the old in the same step) — so there's never an empty frame, and the
 * new level appears at full opacity (no fade). Only genuinely new cells fade in.
 * A {@link HYSTERESIS} dead-band stops the level flip-flopping at the boundary.
 *
 * Cells are loaded asynchronously via the adapter (which caches them) and added
 * under the streaming root (Z-up; the root applies the −90°X).
 */
export class StreamingSystem implements System {
  readonly name = 'streaming';

  private readonly adapter: StreamAdapter;
  private readonly config: Readonly<Config>;
  private current = new Set<string>();
  private readonly fader = new CellFader();
  private readonly loaded = new Map<string, Object3D[]>();
  private readonly loading = new Set<string>();
  private manual: ManualSelection | null = null;
  private readonly root: Object3D;
  private readonly viewOf: () => Vec3;

  constructor(adapter: StreamAdapter, root: Object3D, viewOf: () => Vec3, config: Readonly<Config>) {
    this.adapter = adapter;
    this.root = root;
    this.viewOf = viewOf;
    this.config = config;
  }

  /** Debug: render an explicit set of cells at one detail level (null resumes streaming). */
  setManualCells(cells: CellCoord[] | null, lod = false): void {
    this.manual = cells ? { cells, lod } : null;
  }

  update(delta = 0): void {
    this.fader.update(delta);
    this.current = this.desiredKeys();
    // Load desired-but-missing cells (async; the handler adds + swaps when ready).
    for (const key of this.current) {
      if (!this.loaded.has(key) && !this.loading.has(key)) {
        this.load(key);
      }
    }
    // Remove cells that left the view — but keep an old detail level while its same-cell replacement
    // is still loading, so the swap never leaves a hole (the load handler removes it once the new
    // level is in).
    const loadingCells = new Set([...this.loading].map(cellOfKey));
    for (const [key, objects] of this.loaded) {
      if (this.current.has(key) || loadingCells.has(cellOfKey(key))) {
        continue;
      }
      this.remove(key, objects);
    }
  }

  /** The grid cell the current view is in (for the debug section inspector). */
  viewCell(): CellCoord {
    return cellOf(this.viewOf(), this.adapter.cellSize);
  }

  private desiredKeys(): Set<string> {
    if (this.config.mapViewer && this.manual) {
      return new Set(this.manual.cells.map(([cx, cy]) => streamKey(cx, cy, this.manual!.lod)));
    }

    return this.streamKeys();
  }

  private load(key: string): void {
    this.loading.add(key);
    const [cx, cy, kind] = key.split(',');
    void this.adapter
      .loadCell({ cx: Number(cx), cy: Number(cy), lod: kind === 'lod' })
      .then((objects) => {
        this.loading.delete(key);
        if (!this.current.has(key) || this.loaded.has(key)) {
          return; // no longer wanted, or already loaded
        }
        // Add the new level FIRST (full opacity) so the cell is never empty…
        objects.forEach((object) => this.root.add(object));
        this.loaded.set(key, objects);
        const otherKey = otherLevelKey(key);
        const otherObjects = this.loaded.get(otherKey);
        if (otherObjects) {
          this.remove(otherKey, otherObjects); // …then drop the old level → seamless swap, no fade
        } else if (!this.config.mapViewer) {
          this.fader.start(key, objects); // genuinely new cell: fade in (swaps never fade)
        }
      })
      .catch(() => this.loading.delete(key));
  }

  private remove(key: string, objects: readonly Object3D[]): void {
    this.fader.cancel(key); // restore materials before the cell mesh goes back to the cache
    objects.forEach((object) => this.root.remove(object));
    this.loaded.delete(key);
  }

  /** Desired stream keys with the hysteresis dead-band: a cell keeps its current level until the view
   *  moves a margin past the ring boundary (sticky on what's already loaded/loading). */
  private streamKeys(): Set<string> {
    const view = this.viewOf();
    const size = this.adapter.cellSize;
    const { hdDrawDistance, lodDrawDistance } = this.config.streaming;
    const margin = size * HYSTERESIS;
    const keys = new Set<string>();

    for (const [cx, cy] of cellsWithin(view, lodDrawDistance + margin, size)) {
      const distSq = cellDistanceSq(view, cx, cy, size);
      const hdKey = streamKey(cx, cy, false);
      const lodKey = streamKey(cx, cy, true);
      const hdSticky = this.loaded.has(hdKey) || this.loading.has(hdKey);
      const anySticky = hdSticky || this.loaded.has(lodKey) || this.loading.has(lodKey);
      // Already-HD cells hold HD a margin past the ring; already-loaded cells hold LOD a margin past it.
      const hdReach = hdDrawDistance + (hdSticky ? margin : 0);
      const lodReach = lodDrawDistance + (anySticky ? margin : 0);
      if (distSq <= hdReach * hdReach) {
        keys.add(hdKey);
      } else if (distSq <= lodReach * lodReach) {
        keys.add(lodKey);
      }
    }

    return keys;
  }
}

/** The `cx,cy` of a stream key (drops the `hd`/`lod` level suffix). */
function cellOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf(','));
}

/** The same cell's OTHER detail level key (`hd` ↔ `lod`). */
function otherLevelKey(key: string): string {
  const cut = key.lastIndexOf(',');

  return `${key.slice(0, cut)},${key.endsWith(',lod') ? 'hd' : 'lod'}`;
}

function streamKey(cx: number, cy: number, lod: boolean): string {
  return `${cx},${cy},${lod ? 'lod' : 'hd'}`;
}
