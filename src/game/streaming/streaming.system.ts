import type { Object3D } from 'three';

import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, WorldAdapter } from '../interfaces/world-adapter.interface';
import type { CellCoord } from './grid';

import { cellOf, cellsWithin } from './grid';

interface ManualSelection {
  cells: CellCoord[];
  lod: boolean;
}

/** What the streaming system needs from the world adapter. */
type StreamAdapter = Pick<WorldAdapter, 'cellSize' | 'loadCell'>;

/**
 * Streams map cells in/out of the streaming root as the view moves. Two modes:
 * - **stream** (default): cells within `hdDrawDistance` render HD, cells within
 *   `lodDrawDistance` (beyond the HD ring) render LOD — the sectioned grid.
 * - **manual** (debug): renders only the cells set via {@link setManualCells} at
 *   one detail level. Active while `config.debugMode` is on and a selection is set.
 *
 * Cells are loaded asynchronously via the adapter (which caches them) and added
 * under the streaming root (Z-up; the root applies the −90°X). Unloading just
 * removes them from the root — the adapter keeps the cached meshes.
 */
export class StreamingSystem implements System {
  readonly name = 'streaming';

  private readonly adapter: StreamAdapter;
  private readonly config: Readonly<Config>;
  private current = new Set<string>();
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

  update(): void {
    this.current = this.desiredKeys();
    for (const [key, objects] of this.loaded) {
      if (!this.current.has(key)) {
        objects.forEach((object) => this.root.remove(object));
        this.loaded.delete(key);
      }
    }
    for (const key of this.current) {
      if (!this.loaded.has(key) && !this.loading.has(key)) {
        this.load(key);
      }
    }
  }

  /** The grid cell the current view is in (for the debug section inspector). */
  viewCell(): CellCoord {
    return cellOf(this.viewOf(), this.adapter.cellSize);
  }

  private desiredKeys(): Set<string> {
    if (this.config.debugMode && this.manual) {
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
        if (this.current.has(key) && !this.loaded.has(key)) {
          objects.forEach((object) => this.root.add(object));
          this.loaded.set(key, objects);
        }
      })
      .catch(() => this.loading.delete(key));
  }

  private streamKeys(): Set<string> {
    const view = this.viewOf();
    const size = this.adapter.cellSize;
    const { hdDrawDistance, lodDrawDistance } = this.config.streaming;
    const keys = new Set<string>();
    const hd = new Set<string>();

    for (const [cx, cy] of cellsWithin(view, hdDrawDistance, size)) {
      const key = streamKey(cx, cy, false);
      hd.add(key);
      keys.add(key);
    }
    for (const [cx, cy] of cellsWithin(view, lodDrawDistance, size)) {
      if (!hd.has(streamKey(cx, cy, false))) {
        keys.add(streamKey(cx, cy, true)); // LOD only where there's no HD
      }
    }

    return keys;
  }
}

function streamKey(cx: number, cy: number, lod: boolean): string {
  return `${cx},${cy},${lod ? 'lod' : 'hd'}`;
}
