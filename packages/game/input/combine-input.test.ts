import { describe, expect, it } from 'vitest';

import type { InputState } from './input-state';

import { CombinedInput } from './combine-input';

/** An InputState stub; unspecified signals are neutral. */
function source(partial: Partial<InputState>): InputState {
  return {
    consumeLook: () => ({ x: 0, y: 0 }),
    consumeZoom: () => 0,
    isActive: () => false,
    move: () => ({ x: 0, y: 0 }),
    ...partial,
  };
}

describe('CombinedInput', () => {
  describe('negative cases', () => {
    it('is neutral with no sources', () => {
      const input = new CombinedInput();
      expect(input.move()).toEqual({ x: 0, y: 0 });
      expect(input.isActive('jump')).toBe(false);
      expect(input.consumeLook()).toEqual({ x: 0, y: 0 });
      expect(input.consumeZoom()).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('sums move vectors and clamps each axis to [-1, 1]', () => {
      const input = new CombinedInput([
        source({ move: () => ({ x: 1, y: 0 }) }),
        source({ move: () => ({ x: 1, y: 1 }) }),
      ]);
      expect(input.move()).toEqual({ x: 1, y: 1 }); // x: 1 + 1 clamped to 1
    });

    it('ORs held actions across sources', () => {
      const input = new CombinedInput([source({}), source({ isActive: (a) => a === 'run' })]);
      expect(input.isActive('run')).toBe(true);
      expect(input.isActive('jump')).toBe(false);
    });

    it('accumulates look/zoom across sources and consumes each once', () => {
      const pointer = source({ consumeLook: () => ({ x: 3, y: -2 }), consumeZoom: () => 5 });
      let looked = false;
      const drag = source({
        consumeLook: () => (looked ? { x: 0, y: 0 } : ((looked = true), { x: 1, y: 1 })),
      });
      const input = new CombinedInput([pointer, drag]);

      expect(input.consumeLook()).toEqual({ x: 4, y: -1 }); // 3+1, -2+1
      expect(input.consumeZoom()).toBe(5);
    });

    it('includes a source added after construction', () => {
      const input = new CombinedInput();
      input.add(source({ move: () => ({ x: -1, y: 0 }) }));
      expect(input.move()).toEqual({ x: -1, y: 0 });
    });
  });
});
