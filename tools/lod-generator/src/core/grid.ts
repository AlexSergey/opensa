import type { Vec3 } from './types';

/** Stable string key for a cell coordinate. */
export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** The square grid cell a world position falls in (X/Y plane; Z ignored — mirrors the engine's `world-grid`). */
export function cellOf(position: Vec3, cellSize: number): [number, number] {
  return [Math.floor(position[0] / cellSize), Math.floor(position[1] / cellSize)];
}
