import type { LitFadeConfig } from '../interfaces/config.interface';

/**
 * Night factor for night-lit map content — the **night vertex colours** (lit windows) **and** the ACES night
 * tonemap both ride this so they switch on a wall-clock time, not the sun height. The dusk/dawn window comes
 * from {@link LitFadeConfig} (debug-tunable); single source of truth for both consumers.
 */
export function clockNightFactor(hour: number, fade: LitFadeConfig): number {
  return nightHourFactor(hour, fade.duskStart, fade.duskEnd, fade.dawnStart, fade.dawnEnd);
}

/**
 * Whether `hour` (0–24) falls in the window `[on, off)`, wrapping midnight when `on > off`
 * (e.g. `[20, 6)` = 20:00 through 06:00). A degenerate window (`on === off`) is always true.
 * Shared by the timed-object gating and the night-lights/coronas.
 */
export function inHourWindow(hour: number, on: number, off: number): boolean {
  if (on === off) {
    return true;
  }

  return on < off ? hour >= on && hour < off : hour >= on || hour < off;
}

/**
 * Smooth 0–1 night factor driven by the game clock (not sun height): 1 across the full night core
 * `[onEnd, offStart)` (wrapping midnight), 0 by day, with linear fades over `[onStart, onEnd)` (dusk,
 * 0→1) and `[offStart, offEnd)` (dawn, 1→0). The two fade ramps must each lie within a single day
 * (no midnight wrap); the always-on core does the wrapping. Used to gate the night vertex colours on a
 * fixed schedule (e.g. dawn fade 06:00→07:00) instead of the sun-height signal.
 */
export function nightHourFactor(
  hour: number,
  onStart: number,
  onEnd: number,
  offStart: number,
  offEnd: number,
): number {
  if (hour >= onStart && hour < onEnd) {
    return (hour - onStart) / (onEnd - onStart); // dusk fade-in
  }
  if (hour >= offStart && hour < offEnd) {
    return 1 - (hour - offStart) / (offEnd - offStart); // dawn fade-out
  }

  return inHourWindow(hour, onEnd, offStart) ? 1 : 0; // full overnight vs flat day
}
