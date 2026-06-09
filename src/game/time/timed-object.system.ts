import type { Object3D } from 'three';

import type { System } from '../core/system';

import { inHourWindow } from './hour-window';

/** A `tobj` visibility window in hours: `[on, off)`, wrapping midnight when `on > off`. */
interface TimedWindow {
  off: number;
  on: number;
}

/**
 * Shows/hides time-of-day (`tobj`) objects by the game hour. Streamed map meshes tagged with
 * `userData.timed = { on, off }` (see `build-region`) are visible only while the hour is inside their
 * window — e.g. lit-window night variants `[20, 6)`. Cheap: walks the streaming root's direct children
 * and sets `.visible`; runs each frame so freshly streamed cells are gated immediately (no wrong-time flash).
 */
export class TimedObjectSystem implements System {
  readonly name = 'timed-objects';

  private readonly getHours: () => number;
  private readonly root: Object3D;

  constructor(root: Object3D, getHours: () => number) {
    this.root = root;
    this.getHours = getHours;
  }

  update(): void {
    const hour = ((this.getHours() % 24) + 24) % 24;
    for (const child of this.root.children) {
      const window = child.userData.timed as TimedWindow | undefined;
      if (window) {
        child.visible = inHourWindow(hour, window.on, window.off);
      }
    }
  }
}
