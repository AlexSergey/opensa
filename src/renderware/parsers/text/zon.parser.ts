/**
 * GTA San Andreas `map.zon` — the city boxes. Each line in the `zone … end` block reads
 * `name, type, x1, y1, z1, x2, y2, z2, level, label`; we keep the 2D (x, y) extent and the **level** (the
 * city: 1 = Los Santos, 2 = San Fierro, 3 = Las Venturas). `z1/z2` span the full height, so a 2D AABB
 * classifies a point. Mapping level → city and the point test live in the game layer (`game/zones/city`).
 */

/** A city box from `map.zon`: a 2D area (world x/y, native Z-up) + its `level` (the city). */
export interface MapZone {
  level: number;
  max: [number, number];
  min: [number, number];
  name: string;
}

/** Parse the `map.zon` city boxes; comment/section/malformed lines are skipped, z is ignored. */
export function parseZones(text: string): MapZone[] {
  const zones: MapZone[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line === 'zone' || line === 'end' || line.startsWith('#') || line.startsWith('//')) {
      continue;
    }
    const parts = line.split(',').map((part) => part.trim());
    if (parts.length < 9) {
      continue;
    }
    const [name, , x1, y1, , x2, y2, , levelToken] = parts;
    const level = Number(levelToken);
    const bounds = [x1, y1, x2, y2].map(Number);
    if (!Number.isFinite(level) || bounds.some((n) => !Number.isFinite(n))) {
      continue;
    }
    const [ax, ay, bx, by] = bounds;
    zones.push({
      level,
      max: [Math.max(ax, bx), Math.max(ay, by)],
      min: [Math.min(ax, bx), Math.min(ay, by)],
      name,
    });
  }

  return zones;
}
