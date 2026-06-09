import type { Object3D } from 'three';

import type { System } from '../core/system';

/** Answers "what's the ground Z under (x, y, z)?" — the physics world (a downward raycast). */
export interface GroundProbe {
  groundZBelow(x: number, y: number, z: number, maxDrop: number): null | number;
}

/** The shape renderware stashes on a pool mesh's `userData.lightPools` (read structurally — no renderware
 *  import from the game layer): each pool's X/Y + ground-Z estimate, plus a closure that re-seats it. */
interface PendingPools {
  drop(index: number, groundZ: number): void;
  readonly entries: readonly { position: readonly number[] }[];
}

const PROBE_INTERVAL = 0.25; // seconds between sweeps — pools are static once dropped, no need to rush
// Search the real ground in a small window AROUND the model-foot estimate (which already ≈ the ground), not
// far down from the bulb: a far ray could punch through a missing-collision gap onto a much lower surface and
// bury the pool for good. The search is almost entirely DOWNWARD (correcting a foot that floats over a kerb);
// `SEARCH_UP` is kept tiny on purpose — a light sitting directly over the pole (e.g. lamppost2's centre lamp)
// self-hits the pole's own collision at the ray start, so a large up-margin would lift its pool off the
// ground onto the post. 0.3 keeps that lift negligible while still tolerating a foot slightly under the road.
const SEARCH_UP = 0.3;
const SEARCH_DOWN = 8;
const PER_TICK = 128; // raycast budget per sweep (caps the spike when many cells stream in at once)

/**
 * Drops street-lamp light pools onto the real terrain. A pool is built (in renderware) at the lamp model's
 * foot Z as a first guess, but a lamp may stand on a curb/bridge so its foot floats above the road. Each
 * sweep this rays straight down from the bulb to the static collision and re-seats the pool quad on the hit.
 * Deferred + retried: the collision under a freshly-streamed cell may not be loaded yet. Once a mesh's pools
 * are all dropped it clears `userData.lightPools`, so it stops being scanned (and stays put if it re-streams).
 */
export class LightPoolSystem implements System {
  readonly name = 'light-pools';

  private readonly probe: GroundProbe;
  /** Per-mesh "this pool is dropped" flags, so a partly-resolved mesh resumes where it left off. */
  private readonly resolved = new WeakMap<object, boolean[]>();
  private readonly root: Object3D;
  private timer = 0;

  constructor(root: Object3D, probe: GroundProbe) {
    this.root = root;
    this.probe = probe;
  }

  update(delta = 0): void {
    this.timer += delta;
    if (this.timer < PROBE_INTERVAL) {
      return;
    }
    this.timer = 0;
    let budget = PER_TICK;
    for (const child of this.root.children) {
      if (budget <= 0) {
        break;
      }
      const pending = child.userData.lightPools as PendingPools | undefined;
      if (pending) {
        budget -= this.resolveMesh(child, pending, budget);
      }
    }
  }

  /** Drop as many of a mesh's pending pools as `budget` allows; returns the rays it spent. */
  private resolveMesh(mesh: Object3D, pending: PendingPools, budget: number): number {
    const { entries } = pending;
    let done = this.resolved.get(mesh);
    if (!done) {
      done = new Array(entries.length).fill(false);
      this.resolved.set(mesh, done);
    }
    let spent = 0;
    let unresolved = 0;
    for (let i = 0; i < entries.length; i += 1) {
      if (done[i]) {
        continue;
      }
      if (spent >= budget) {
        unresolved += 1; // out of budget this sweep — leave it for the next one
        continue;
      }
      const entry = entries[i];
      spent += 1;
      // Ray from just above the estimate, only a short way down — keeps the hit local to the lamp's terrain.
      const from = entry.position[2] + SEARCH_UP;
      const groundZ = this.probe.groundZBelow(entry.position[0], entry.position[1], from, SEARCH_UP + SEARCH_DOWN);
      if (groundZ === null) {
        unresolved += 1; // no ground in the window yet (collision not loaded) — retry; stays at the estimate
        continue;
      }
      pending.drop(i, groundZ);
      done[i] = true;
    }
    if (unresolved === 0) {
      mesh.userData.lightPools = undefined; // all dropped → stop scanning this mesh
    }

    return spent;
  }
}
