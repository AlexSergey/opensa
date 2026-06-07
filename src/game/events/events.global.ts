import type { LogEntry } from '../diagnostics/logger';
import type { GameState } from '../interfaces/config.interface';
import type { WorldObjectInfo } from '../interfaces/world-adapter.interface';

/** Typed event map for the game's {@link EventBus}. */
export interface GameEvents {
  'game-state': { state: GameState };
  loaded: void;
  loading: { fraction: number };
  log: LogEntry;
  'map-viewer': { enabled: boolean };
  ready: void;
  select: null | WorldObjectInfo;
  /** In-game clock ticked to a new whole minute (minutes since midnight). */
  time: { minutes: number };
}
