import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, WorldAdapter } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld } from '../physics/physics-world';

import { cellKey, cellsWithin } from './grid';

/** What collision streaming needs from the adapter / physics world. */
type ColliderAdapter = Pick<WorldAdapter, 'cellSize' | 'loadCellColliders'>;
type ColliderPhysics = Pick<PhysicsWorld, 'createStaticColliders' | 'removeBodies'>;

/**
 * Streams static map collision per grid cell around the view (the same grid the
 * renderer uses), so the player always has ground/walls without holding the whole
 * map in the physics world. Each `update`: view cell → desired cells within
 * `collisionDrawDistance` → diff the loaded set → `loadCellColliders` +
 * `createStaticColliders` for new cells (tracking their body handles), and
 * `removeBodies` for cells that left. Collision is HD-only (LODs have none) and
 * Z-up. The radius carries a margin so colliders are ready a cell before the
 * player arrives (the async load is tolerated).
 */
export class CollisionStreamingSystem implements System {
  readonly name = 'collision-streaming';

  private readonly adapter: ColliderAdapter;
  private readonly config: Readonly<Config>;
  private current = new Set<string>();
  private readonly loaded = new Map<string, number[]>();
  private readonly loading = new Set<string>();
  private readonly physics: ColliderPhysics;
  private readonly viewOf: () => Vec3;

  constructor(adapter: ColliderAdapter, physics: ColliderPhysics, viewOf: () => Vec3, config: Readonly<Config>) {
    this.adapter = adapter;
    this.physics = physics;
    this.viewOf = viewOf;
    this.config = config;
  }

  /** Drop every loaded cell's physics bodies — the next `update` re-streams them through the
   *  adapter (whose collider cache the caller invalidated first). Used when the procedural-clutter
   *  knobs change, so collision always matches the rendered set (plan 042). */
  reload(): void {
    for (const handles of this.loaded.values()) {
      this.physics.removeBodies(handles);
    }
    this.loaded.clear();
  }

  update(): void {
    this.current = this.desiredKeys();
    for (const [key, handles] of this.loaded) {
      if (!this.current.has(key)) {
        this.physics.removeBodies(handles);
        this.loaded.delete(key);
      }
    }
    for (const key of this.current) {
      if (!this.loaded.has(key) && !this.loading.has(key)) {
        this.load(key);
      }
    }
  }

  private desiredKeys(): Set<string> {
    const cells = cellsWithin(this.viewOf(), this.config.streaming.collisionDrawDistance, this.adapter.cellSize);

    return new Set(cells.map(([cx, cy]) => cellKey(cx, cy)));
  }

  private load(key: string): void {
    this.loading.add(key);
    const [cx, cy] = key.split(',');
    void this.adapter
      .loadCellColliders(Number(cx), Number(cy))
      .then((models) => {
        this.loading.delete(key);
        if (this.current.has(key) && !this.loaded.has(key)) {
          this.loaded.set(key, this.physics.createStaticColliders(models));
        }
      })
      .catch(() => this.loading.delete(key));
  }
}
