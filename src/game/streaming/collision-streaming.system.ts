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
  /** Breakable-prop bodies (plan 045): instance key → its cell + body handle, so a smashed prop's
   *  one static body can be dropped without disturbing the rest of its cell. */
  private readonly breakable = new Map<string, { cellKey: string; handle: number }>();
  /** Reverse of {@link breakable}: body handle → instance key, so a contact-force impact on a static
   *  body can be resolved to the prop it hit. */
  private readonly breakableByHandle = new Map<number, string>();
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
  /** The breakable instance key of a static body handle (from a contact-force impact), if any. */
  breakableKeyOf(handle: null | number): string | undefined {
    return handle === null ? undefined : this.breakableByHandle.get(handle);
  }

  reload(): void {
    for (const handles of this.loaded.values()) {
      this.physics.removeBodies(handles);
    }
    this.loaded.clear();
    this.breakable.clear();
    this.breakableByHandle.clear();
  }

  /** Drop a smashed breakable prop's static body (plan 045). No-op if it is already gone (already
   *  broken, or its cell unloaded). Returns whether a body was removed. */
  removeBreakable(key: string): boolean {
    const entry = this.breakable.get(key);
    if (!entry) {
      return false;
    }
    this.breakable.delete(key);
    this.breakableByHandle.delete(entry.handle);
    this.physics.removeBodies([entry.handle]);
    const handles = this.loaded.get(entry.cellKey);
    const index = handles?.indexOf(entry.handle) ?? -1;
    if (handles && index >= 0) {
      handles.splice(index, 1); // so the cell unload doesn't double-remove the handle
    }

    return true;
  }

  update(): void {
    this.current = this.desiredKeys();
    for (const [key, handles] of this.loaded) {
      if (!this.current.has(key)) {
        this.physics.removeBodies(handles);
        this.loaded.delete(key);
        this.forgetBreakables(key);
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

  /** Drop a cell's breakable bookkeeping when it unloads (its bodies are removed with the cell). */
  private forgetBreakables(cellKey: string): void {
    for (const [key, entry] of this.breakable) {
      if (entry.cellKey === cellKey) {
        this.breakable.delete(key);
        this.breakableByHandle.delete(entry.handle);
      }
    }
  }

  private load(key: string): void {
    this.loading.add(key);
    const [cx, cy] = key.split(',');
    void this.adapter
      .loadCellColliders(Number(cx), Number(cy))
      .then((models) => {
        this.loading.delete(key);
        if (this.current.has(key) && !this.loaded.has(key)) {
          this.loaded.set(
            key,
            this.physics.createStaticColliders(models, (instanceKey, handle) => {
              this.breakable.set(instanceKey, { cellKey: key, handle });
              this.breakableByHandle.set(handle, instanceKey);
            }),
          );
        }
      })
      .catch(() => this.loading.delete(key));
  }
}
