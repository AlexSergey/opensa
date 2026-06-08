import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';

import { TimedObjectSystem } from './timed-object.system';

/** A root with one child per time window (plus an untagged one), for visibility assertions. */
function rootWith(windows: (null | { off: number; on: number })[]): Object3D {
  const root = new Object3D();
  for (const window of windows) {
    const child = new Object3D();
    if (window) {
      child.userData.timed = window;
    }
    root.add(child);
  }

  return root;
}

describe('TimedObjectSystem', () => {
  describe('negative cases', () => {
    it('leaves untagged children untouched', () => {
      const root = rootWith([null]);
      new TimedObjectSystem(root, () => 3).update();
      expect(root.children[0].visible).toBe(true);
    });

    it('hides a daytime [6,20) object at night', () => {
      const root = rootWith([{ off: 20, on: 6 }]);
      new TimedObjectSystem(root, () => 23).update();
      expect(root.children[0].visible).toBe(false);
    });

    it('hides a wrapping night [20,6) object during the day', () => {
      const root = rootWith([{ off: 6, on: 20 }]);
      new TimedObjectSystem(root, () => 12).update();
      expect(root.children[0].visible).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('shows a daytime [6,20) object during the day', () => {
      const root = rootWith([{ off: 20, on: 6 }]);
      new TimedObjectSystem(root, () => 12).update();
      expect(root.children[0].visible).toBe(true);
    });

    it('shows a wrapping night [20,6) object after midnight', () => {
      const root = rootWith([{ off: 6, on: 20 }]);
      new TimedObjectSystem(root, () => 2).update();
      expect(root.children[0].visible).toBe(true);
    });

    it('wraps the game hour past 24', () => {
      const root = rootWith([{ off: 6, on: 20 }]);
      new TimedObjectSystem(root, () => 26).update(); // 26h → 2:00
      expect(root.children[0].visible).toBe(true);
    });
  });
});
