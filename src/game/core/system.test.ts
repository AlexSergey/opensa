import { describe, expect, it } from 'vitest';

import type { System } from './system';

import { SystemRegistry } from './system';

/** A system that records the update/fixedUpdate steps it received. */
function recorder(name: string): { fixed: number[]; frames: number[]; system: System } {
  const fixed: number[] = [];
  const frames: number[] = [];

  return {
    fixed,
    frames,
    system: {
      fixedUpdate: (step: number): void => {
        fixed.push(step);
      },
      name,
      update: (delta: number): void => {
        frames.push(delta);
      },
    },
  };
}

describe('SystemRegistry', () => {
  describe('negative cases', () => {
    it('does nothing when empty', () => {
      const registry = new SystemRegistry();
      expect(() => {
        registry.update(0.016);
        registry.fixedUpdate(0.02);
      }).not.toThrow();
    });

    it('skips systems without the matching hook', () => {
      const registry = new SystemRegistry();
      let fixedRan = false;
      registry.add({ fixedUpdate: () => (fixedRan = true), name: 'fixed-only' }); // no update()
      registry.update(0.016); // must not throw on the missing update hook
      expect(fixedRan).toBe(false);
    });

    it('stops updating a removed system', () => {
      const registry = new SystemRegistry();
      const a = recorder('a');
      registry.add(a.system);
      registry.remove(a.system);
      registry.update(0.016);
      expect(a.frames).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('routes update/fixedUpdate to every registered system in order', () => {
      const registry = new SystemRegistry();
      const a = recorder('a');
      const b = recorder('b');
      registry.add(a.system);
      registry.add(b.system);
      registry.update(0.016);
      registry.fixedUpdate(0.02);
      expect(a.frames).toEqual([0.016]);
      expect(b.frames).toEqual([0.016]);
      expect(a.fixed).toEqual([0.02]);
      expect(b.fixed).toEqual([0.02]);
    });
  });
});
