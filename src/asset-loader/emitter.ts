/**
 * A tiny typed event emitter (pure, no DOM/`EventTarget`) so the loader can report progress without
 * coupling to React or the game. `Events` maps an event name to its payload type.
 */
export type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<keyof Events, unknown>> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  /** Emit `payload` to every listener of `event` (snapshot, so a handler may unsubscribe mid-emit). */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as Listener<Events[K]>)(payload);
    }
  }

  /** Remove a previously-added listener (safe to call for one never added). */
  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Subscribe to `event`; returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener<never>>();
    set.add(listener);
    this.listeners.set(event, set);

    return () => this.off(event, listener);
  }
}
