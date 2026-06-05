import type { WorldObjectInfo } from '../interfaces/world-adapter.interface';

/** Typed event map for the game's {@link EventBus}. */
export interface GameEvents {
  'debug-mode': { enabled: boolean };
  loaded: void;
  loading: { fraction: number };
  ready: void;
  select: null | WorldObjectInfo;
}
