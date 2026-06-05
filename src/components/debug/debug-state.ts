// TEMPORARY global debug state: the DEBUG_MODE flag (on while the Ctrl+D popup is
// open) and the last clicked-model selection. Remove with components/debug.
// Later: move DEBUG_MODE into a proper config module (see memory).

export interface DebugSelection {
  modelName: string;
  /** GTA Z-up world position. */
  position: [number, number, number];
  txdName: string;
}

let enabled = false;
let current: DebugSelection | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export const debugState = {
  isEnabled(): boolean {
    return enabled;
  },
  select(value: DebugSelection | null): void {
    current = value;
    emit();
  },
  selection(): DebugSelection | null {
    return current;
  },
  setMode(value: boolean): void {
    enabled = value;
    if (!value) {
      current = null;
    }
    Reflect.set(globalThis, 'DEBUG_MODE', value); // also exposed as window.DEBUG_MODE for the console
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return (): void => {
      listeners.delete(listener);
    };
  },
};
