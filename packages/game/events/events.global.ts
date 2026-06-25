import type { LogEntry } from '../diagnostics/logger';
import type { GameState } from '../interfaces/config.interface';
import type { WorldObjectInfo } from '../interfaces/world-adapter.interface';
import type { City } from '../zones/city';

/** Typed event map for the game's {@link EventBus}. */
export interface GameEvents {
  /** Player moved into a different city (Los Santos / San Fierro / Las Venturas / Countryside). */
  city: { city: City };
  'fly-camera': { enabled: boolean };
  'game-state': { state: GameState };
  loaded: void;
  loading: { fraction: number };
  log: LogEntry;
  'map-viewer': { enabled: boolean };
  ready: void;
  select: null | WorldObjectInfo;
  /** In-game clock ticked to a new whole minute (minutes since midnight). */
  time: { minutes: number };
  /** Player moved into a different named district (`info.zon` zone); `name` is the resolved GXT text. */
  zone: { name: string };
}
