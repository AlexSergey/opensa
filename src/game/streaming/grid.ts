import type { Vec3 } from '../interfaces/world-adapter.interface';

/** A grid cell coordinate `[cx, cy]` (X/Y plane; Z is ignored). */
export type CellCoord = [number, number];

/** Stable string key for a cell coordinate (matches the renderware grid's format). */
export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** The grid cell a world position (GTA Z-up) falls in. */
export function cellOf(position: Vec3, cellSize: number): CellCoord {
  return [Math.floor(position[0] / cellSize), Math.floor(position[1] / cellSize)];
}

/**
 * All cells whose square comes within `radius` (world units) of `position` — a
 * circular-ish set used for the HD / LOD draw-distance rings. `radius` must be
 * finite. A cell is included when its nearest point to `position` is ≤ `radius`,
 * so corner cells beyond the radius are excluded.
 */
export function cellsWithin(position: Vec3, radius: number, cellSize: number): CellCoord[] {
  const [vx, vy] = cellOf(position, cellSize);
  const reach = Math.ceil(radius / cellSize);
  const radiusSq = radius * radius;
  const cells: CellCoord[] = [];

  for (let dy = -reach; dy <= reach; dy += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const cx = vx + dx;
      const cy = vy + dy;
      if (cellDistanceSq(position, cx, cy, cellSize) <= radiusSq) {
        cells.push([cx, cy]);
      }
    }
  }

  return cells;
}

/** Squared distance from `position` to the nearest point of cell `(cx,cy)`'s square (Z ignored). */
export function cellDistanceSq(position: Vec3, cx: number, cy: number, cellSize: number): number {
  const minX = cx * cellSize;
  const minY = cy * cellSize;
  const nx = clamp(position[0], minX, minX + cellSize);
  const ny = clamp(position[1], minY, minY + cellSize);
  const dx = position[0] - nx;
  const dy = position[1] - ny;

  return dx * dx + dy * dy;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
