import { AnimationClip, Object3D, VectorKeyframeTrack } from 'three';
import { afterEach, describe, expect, it } from 'vitest';

import { registerAnimatedObject, resetAnimatedObjects, updateAnimatedObjects } from './animated-objects';

/** A 1s looping clip that slides root.position.x from 0 to 10 (so progress is observable on the root). */
function slideClip(): AnimationClip {
  return new AnimationClip('slide', 1, [new VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 10, 0, 0])]);
}

afterEach(() => resetAnimatedObjects());

describe('updateAnimatedObjects', () => {
  describe('negative cases', () => {
    it('does not advance an object whose root is detached (streamed out → paused)', () => {
      const root = new Object3D();
      registerAnimatedObject(root, slideClip());
      updateAnimatedObjects(0.5);
      expect(root.position.x).toBe(0);
    });

    it('no-ops after the registry is reset', () => {
      const root = new Object3D();
      new Object3D().add(root);
      registerAnimatedObject(root, slideClip());
      resetAnimatedObjects();
      updateAnimatedObjects(0.5);
      expect(root.position.x).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('advances an attached object by delta along its clip', () => {
      const root = new Object3D();
      new Object3D().add(root);
      registerAnimatedObject(root, slideClip());
      updateAnimatedObjects(0.5);
      expect(root.position.x).toBeCloseTo(5, 5);
    });

    it('pauses while detached and resumes from where it left off on reattach', () => {
      const parent = new Object3D();
      const root = new Object3D();
      registerAnimatedObject(root, slideClip());
      updateAnimatedObjects(0.5); // detached → mixer time stays 0
      expect(root.position.x).toBe(0);
      parent.add(root);
      updateAnimatedObjects(0.5); // now attached → applies at mixer time 0.5
      expect(root.position.x).toBeCloseTo(5, 5);
    });
  });
});
