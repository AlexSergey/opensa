import { describe, expect, it, vi } from 'vitest';

import { PointerLookSource } from './pointer-look-source';

interface FakeEvent {
  deltaY?: number;
  movementX?: number;
  movementY?: number;
  preventDefault?: () => void;
}
type Listener = (event: FakeEvent) => void;

/** A fake target capturing event listeners so they can be fired with synthetic events (no DOM). */
function fakeTarget(): { fire: (type: string, event: FakeEvent) => void; target: HTMLElement } {
  const listeners: Record<string, Listener | undefined> = {};
  const target = {
    addEventListener: (type: string, handler: unknown): void => {
      listeners[type] = handler as Listener;
    },
    removeEventListener: (type: string): void => {
      listeners[type] = undefined;
    },
  } as unknown as HTMLElement;

  return { fire: (type, event) => listeners[type]?.(event), target };
}

describe('PointerLookSource', () => {
  describe('negative cases', () => {
    it('contributes no movement or actions, and zero look/zoom before any event', () => {
      const { target } = fakeTarget();
      const source = new PointerLookSource(target);
      source.start();

      expect(source.move()).toEqual({ x: 0, y: 0 });
      expect(source.isActive()).toBe(false);
      expect(source.consumeLook()).toEqual({ x: 0, y: 0 });
      expect(source.consumeZoom()).toBe(0);
    });

    it('drops accumulated deltas on stop', () => {
      const { fire, target } = fakeTarget();
      const source = new PointerLookSource(target);
      source.start();
      fire('pointermove', { movementX: 4, movementY: 4 });
      source.stop();

      expect(source.consumeLook()).toEqual({ x: 0, y: 0 });
    });
  });

  describe('positive cases', () => {
    it('accumulates pointer-move deltas and clears them on read', () => {
      const { fire, target } = fakeTarget();
      const source = new PointerLookSource(target);
      source.start();

      fire('pointermove', { movementX: 5, movementY: -3 });
      fire('pointermove', { movementX: 2, movementY: 1 });

      expect(source.consumeLook()).toEqual({ x: 7, y: -2 });
      expect(source.consumeLook()).toEqual({ x: 0, y: 0 }); // cleared
    });

    it('accumulates wheel into zoom, prevents page scroll, and clears on read', () => {
      const { fire, target } = fakeTarget();
      const source = new PointerLookSource(target);
      source.start();
      const preventDefault = vi.fn();

      fire('wheel', { deltaY: 120, preventDefault });
      fire('wheel', { deltaY: 30, preventDefault });

      expect(preventDefault).toHaveBeenCalledTimes(2);
      expect(source.consumeZoom()).toBe(150);
      expect(source.consumeZoom()).toBe(0); // cleared
    });
  });
});
