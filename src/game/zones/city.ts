/**
 * City domain (game layer) — which of GTA SA's regions a world point is in. Region tokens match the timecyc
 * weather-name suffix (`_LA` / `_SF` / `_VEGAS` / `_COUNTRYSIDE` / `_DESERT`) so weather-by-zone is a suffix
 * match. The raw `map.zon` (city boxes, by `level`) and `info.zon` (named county boxes, for the desert) are
 * parsed in renderware; the UI maps each box to a {@link CityBox} here.
 */

/** A region in GTA SA (Countryside = outside every city/desert box). */
export type City = 'COUNTRYSIDE' | 'DESERT' | 'LA' | 'SF' | 'VEGAS';

/** A region's AABB in world x/y (native Z-up). */
export interface CityBox {
  city: Exclude<City, 'COUNTRYSIDE'>;
  max: [number, number];
  min: [number, number];
}

/** `map.zon` `level` → city, or null for an unknown level. 1 = Los Santos, 2 = San Fierro, 3 = Las Venturas. */
const CITY_BY_LEVEL: Record<number, 'LA' | 'SF' | 'VEGAS'> = { 1: 'LA', 2: 'SF', 3: 'VEGAS' };

/**
 * The two `info.zon` county zones that make up the **desert**: `BONE` (Bone County, central) + `ROBAD` (Tierra
 * Robada, north-west). These are the desert's big bounding boxes; the smaller desert districts sit inside them.
 */
const DESERT_ZONE_NAMES: ReadonlySet<string> = new Set(['BONE', 'ROBAD']);

/**
 * Which region a world (x, y) is in — the first box containing the point, else Countryside. The caller orders
 * the boxes so **desert boxes come first** (they overlap the coarse Las Venturas city box at its western edge,
 * which is really Bone County, so desert must win there).
 */
export function cityAt(x: number, y: number, boxes: readonly CityBox[]): City {
  for (const box of boxes) {
    if (x >= box.min[0] && x <= box.max[0] && y >= box.min[1] && y <= box.max[1]) {
      return box.city;
    }
  }

  return 'COUNTRYSIDE';
}

export function cityFromLevel(level: number): 'LA' | 'SF' | 'VEGAS' | null {
  return CITY_BY_LEVEL[level] ?? null;
}

/** Whether an `info.zon` zone name is one of the desert county boxes. */
export function isDesertZone(name: string): boolean {
  return DESERT_ZONE_NAMES.has(name.toUpperCase());
}
