import type { EventBus } from '../events/event-bus';
import type { GameEvents } from '../events/events.global';
import type { Config, LogLevel } from '../interfaces/config.interface';

/** Severity ranking; an entry is emitted only when its level is at or above the configured floor. */
const SEVERITY: Record<LogLevel, number> = { debug: 0, error: 3, log: 1, warn: 2 };

/** A single diagnostic record carried on the `'log'` event. */
export interface LogEntry {
  /** Optional structured payload (forces, ids, positions…). */
  data?: unknown;
  level: LogLevel;
  message: string;
  type: LogType;
}

/**
 * Category of a diagnostic entry so subscribers can filter by area (e.g. only
 * `'enter-vehicle'`). Extend this union when a new system starts logging.
 */
export type LogType = 'damage' | 'enter-vehicle' | 'physics' | 'streaming' | 'vehicle';

/**
 * Structured, level-gated diagnostics routed through the game event bus. Silent
 * unless {@link Config.showLogs} names a level; then entries at that severity or
 * higher are emitted as `'log'` events. Subscribe once (in canvas-host) to print
 * or filter — flipping `showLogs` is the single switch that turns logging on.
 */
export class Logger {
  private readonly config: Pick<Config, 'showLogs'>;
  private readonly events: Pick<EventBus<GameEvents>, 'emit'>;

  constructor(events: Pick<EventBus<GameEvents>, 'emit'>, config: Pick<Config, 'showLogs'>) {
    this.events = events;
    this.config = config;
  }

  debug(type: LogType, message: string, data?: unknown): void {
    this.emit('debug', type, message, data);
  }

  error(type: LogType, message: string, data?: unknown): void {
    this.emit('error', type, message, data);
  }

  log(type: LogType, message: string, data?: unknown): void {
    this.emit('log', type, message, data);
  }

  warn(type: LogType, message: string, data?: unknown): void {
    this.emit('warn', type, message, data);
  }

  private emit(level: LogLevel, type: LogType, message: string, data?: unknown): void {
    const floor = this.config.showLogs;
    if (floor === false || SEVERITY[level] < SEVERITY[floor]) {
      return; // off or below the configured floor → zero overhead, no event
    }
    this.events.emit('log', { data, level, message, type });
  }
}
