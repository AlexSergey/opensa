/**
 * GTA San Andreas IPL `interior` (area code) handling.
 *
 * The field is not a plain interior id: the real interior / render-level id is
 * the **low byte** (`value & 0xFF`). The high bits carry other area info and are
 * masked off, e.g. `1024 & 0xFF = 0`, `1030 & 0xFF = 6`, `269 & 0xFF = 13`.
 *
 * `value & 0xFF === 0` alone is NOT enough to mean "exterior": a per-code IPL
 * audit showed some non-zero render-level ids are still the open world — most
 * notably id **13** (it carries ground, roads, traffic, street lights and trees,
 * at ground-level Z), while the genuine hidden interiors (1, 3, 4, 6, 7, 10, 14,
 * 15, 16, 17, 18) live in clusters at Z ≈ 1000 with interior props. So exterior =
 * id 0 OR id in {@link WORLD_INTERIOR_IDS}. A naive "contains a ground/road model"
 * check is unreliable (e.g. the 7-11 interior, id 4, contains `dirtstad`). See
 * memory `ipl-interior-area-code` for the full per-code analysis; extend
 * `WORLD_INTERIOR_IDS` if another world id surfaces.
 */

/** Render-level ids that are part of the open world despite being non-zero. */
const WORLD_INTERIOR_IDS = new Set<number>([13]);

export function interiorId(interior: number): number {
  return interior & 0xff;
}

/** True when an instance belongs to a hidden interior rather than the open world. */
export function isInterior(interior: number): boolean {
  const id = interiorId(interior);

  return id !== 0 && !WORLD_INTERIOR_IDS.has(id);
}
