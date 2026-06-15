import { describe, expect, it, vi } from 'vitest';

import { Emitter } from './emitter';

interface TestEvents {
  hello: { value: number };
  world: { name: string };
}

describe('Emitter', () => {
  describe('negative cases', () => {
    it('emitting with no listeners is a no-op', () => {
      const emitter = new Emitter<TestEvents>();
      expect(() => emitter.emit('hello', { value: 1 })).not.toThrow();
    });

    it('removing a listener that was never added is safe', () => {
      const emitter = new Emitter<TestEvents>();
      expect(() => emitter.off('hello', vi.fn())).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('delivers the payload to every listener of the event', () => {
      const emitter = new Emitter<TestEvents>();
      const a = vi.fn();
      const b = vi.fn();
      emitter.on('hello', a);
      emitter.on('hello', b);
      emitter.emit('hello', { value: 7 });
      expect(a).toHaveBeenCalledWith({ value: 7 });
      expect(b).toHaveBeenCalledWith({ value: 7 });
    });

    it('does not cross events', () => {
      const emitter = new Emitter<TestEvents>();
      const hello = vi.fn();
      emitter.on('hello', hello);
      emitter.emit('world', { name: 'x' });
      expect(hello).not.toHaveBeenCalled();
    });

    it('stops delivery after off() and via the returned unsubscribe', () => {
      const emitter = new Emitter<TestEvents>();
      const viaOff = vi.fn();
      const viaReturn = vi.fn();
      emitter.on('hello', viaOff);
      const unsubscribe = emitter.on('hello', viaReturn);
      emitter.off('hello', viaOff);
      unsubscribe();
      emitter.emit('hello', { value: 1 });
      expect(viaOff).not.toHaveBeenCalled();
      expect(viaReturn).not.toHaveBeenCalled();
    });

    it('lets a handler unsubscribe during emit without skipping others', () => {
      const emitter = new Emitter<TestEvents>();
      const second = vi.fn();
      const unsubscribe = emitter.on('hello', () => unsubscribe());
      emitter.on('hello', second);
      emitter.emit('hello', { value: 1 });
      expect(second).toHaveBeenCalledTimes(1);
    });
  });
});
