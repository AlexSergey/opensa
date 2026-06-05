import { describe, expect, it, vi } from 'vitest';

import { EventBus } from './event-bus';

interface TestEvents {
  ping: void;
  value: { n: number };
}

describe('EventBus', () => {
  it('delivers typed payloads to subscribers', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('value', handler);
    bus.emit('value', { n: 42 });
    expect(handler).toHaveBeenCalledWith({ n: 42 });
  });

  it('supports void events with no payload', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    bus.on('ping', handler);
    bus.emit('ping');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('unsubscribes via the returned disposer', () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    const off = bus.on('value', handler);
    off();
    bus.emit('value', { n: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not throw when emitting an event with no subscribers', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit('ping')).not.toThrow();
  });
});
