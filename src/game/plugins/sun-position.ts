import { MathUtils } from 'three';

/** Sun height at solar noon (radians). */
export const MAX_ELEVATION = MathUtils.degToRad(80);

/** Sun elevation (radians) + unit direction for `hour`, over the day window `[sunrise, sunset]`
 *  (= the `litFade` dawnStart/duskEnd, so the sun tracks the world darkening and custom timecyc):
 *  the sun rises at `sunrise`, peaks at the window's midpoint, and is below the horizon by `sunset`.
 *  Outside the window it's below the horizon — elevation `-1` and the direction points straight down.
 *  Pure (no plugin state) so it's unit-tested; `SkyPlugin` copies `dir` into its reused Vector3.
 *  Three world space: +X east → +Z south → −X west, +Y up. */
export function sunElevationAt(
  hour: number,
  sunrise: number,
  sunset: number,
  maxElevation = MAX_ELEVATION,
): { dir: readonly [number, number, number]; elevation: number } {
  if (hour <= sunrise || hour >= sunset) {
    return { dir: [0, -1, 0], elevation: -1 };
  }
  const t = (hour - sunrise) / (sunset - sunrise); // 0..1 across the day
  const elevation = Math.sin(t * Math.PI) * maxElevation;
  const azimuth = t * Math.PI; // east → west, arcing over the south
  const cosE = Math.cos(elevation);

  return { dir: [Math.cos(azimuth) * cosE, Math.sin(elevation), Math.sin(azimuth) * cosE], elevation };
}
