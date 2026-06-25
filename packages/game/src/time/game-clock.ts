/** Minutes in a day; the clock wraps at midnight. */
const DAY_MINUTES = 1440;

/**
 * The in-game clock: minutes since midnight as a float (wraps at {@link DAY_MINUTES}).
 * Pure — no three.js / loop coupling. `advance` accrues real time scaled by the
 * `secondsPerGameMinute` multiplier and reports when the whole minute ticks over,
 * so callers only emit/log/render on a real change.
 */
export class GameClock {
  /** Continuous minutes since midnight (fractional) — for smooth consumers (sun, sky). */
  get exactMinutes(): number {
    return this.current;
  }

  /** Whole minutes since midnight (0–1439) — for the clock display / `'time'` event. */
  get minutes(): number {
    return Math.floor(this.current);
  }

  private current: number;

  constructor(startMinutes = 0) {
    this.current = wrap(startMinutes);
  }

  /** Current time as `HH:MM` (24h). */
  static format(minutes: number): string {
    const total = Math.floor(wrap(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;

    return `${pad(h)}:${pad(m)}`;
  }

  /** Advance by `deltaSeconds` of real time; returns true when the displayed minute changed. */
  advance(deltaSeconds: number, secondsPerGameMinute: number): boolean {
    if (secondsPerGameMinute <= 0) {
      return false;
    }
    const before = this.minutes;
    this.current = wrap(this.current + deltaSeconds / secondsPerGameMinute);

    return this.minutes !== before;
  }

  /** Jump to a specific time (minutes since midnight; wrapped). */
  set(minutes: number): void {
    this.current = wrap(minutes);
  }
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function wrap(minutes: number): number {
  return ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}
