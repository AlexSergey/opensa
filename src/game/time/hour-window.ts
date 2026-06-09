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
