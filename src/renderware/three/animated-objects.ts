import type { AnimationClip, Object3D } from 'three';

import { AnimationMixer } from 'three';

/**
 * Mixer registry for IFP-animated map objects (plan 041). Each placed object (nodding donkeys,
 * windmills, …) registers once when its cell is first built; the game loop advances every mixer
 * via {@link updateAnimatedObjects}. Streamed-out objects are skipped (their root is detached —
 * the streaming system removes cells from the root but the adapter keeps them cached), so they
 * pause off-screen and resume on re-entry. The registry is bounded by the world's animated
 * instances — they're rare props, a few dozen at most.
 */

interface AnimatedEntry {
  mixer: AnimationMixer;
  root: Object3D;
}

const entries: AnimatedEntry[] = [];

/** Register a placed animated object: loop its clip on a mixer rooted at the object. */
export function registerAnimatedObject(root: Object3D, clip: AnimationClip): void {
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clip).play();
  entries.push({ mixer, root });
}

/** Test hook: drop all registered objects (the registry is module-level shared state). */
export function resetAnimatedObjects(): void {
  entries.length = 0;
}

/** Advance every attached object's mixer by `delta` seconds (detached = streamed out → paused). */
export function updateAnimatedObjects(delta: number): void {
  for (const entry of entries) {
    if (entry.root.parent) {
      entry.mixer.update(delta);
    }
  }
}
