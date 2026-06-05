type EmitArgs<T> = [T] extends [void] ? [] : [T];

type Handler<T> = (payload: T) => void;

/**
 * Tiny typed event bus (no external dep). Events and their payloads are
 * described by a map type (an interface), so `on`/`emit` are fully type-checked.
 */
export class EventBus<E> {
  private readonly handlers = new Map<keyof E, Set<Handler<unknown>>>();

  emit<K extends keyof E>(event: K, ...args: EmitArgs<E[K]>): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    const [payload] = args as [E[K]];
    for (const handler of [...set]) {
      (handler as Handler<E[K]>)(payload);
    }
  }

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);

    return (): void => {
      set.delete(handler as Handler<unknown>);
    };
  }
}
