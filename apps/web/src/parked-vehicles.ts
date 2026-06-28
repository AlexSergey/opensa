import type { VehiclePlacement } from '@opensa/game/vehicle/vehicle-lod.system';

/**
 * The parked-car placements for a game, read from its `parked.json` in the VFS (a serialised
 * {@link VehiclePlacement}[], shipped per game). Returns `[]` when the file is absent or malformed — so a game
 * without `parked.json` simply spawns no parked cars. Lives in the app layer (the VFS file is app/runtime glue).
 */
export function parseParkedVehicles(text: null | string): VehiclePlacement[] {
  if (!text) {
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }

  return Array.isArray(data) ? data.filter(isPlacement) : [];
}

function isPlacement(value: unknown): value is VehiclePlacement {
  const placement = value as Partial<VehiclePlacement>;

  return (
    typeof placement?.model === 'string' &&
    typeof placement.heading === 'number' &&
    Array.isArray(placement.position) &&
    placement.position.length === 3 &&
    placement.position.every((coord) => typeof coord === 'number') &&
    (placement.colour === undefined || typeof placement.colour === 'string')
  );
}
