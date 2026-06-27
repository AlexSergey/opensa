import type { AssetFileSystem } from '@opensa/renderware';

import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

/**
 * Every spawnable vehicle model name, from `vehicles.ide`'s `cars` section (lowercased + sorted) — the canonical
 * list, independent of the loader (a raw install keeps the DFFs in `gta3.img`, not a loose `vehicles/` folder).
 * Drives the debug spawn list, so no hardcoded per-car set is needed. Lives in the app layer (the generic `game`
 * engine may not parse renderware directly — that goes through its adapter).
 */
export function vehicleModelsFromIde(fs: Pick<AssetFileSystem, 'getText'>): string[] {
  const text = fs.getText('data/vehicles.ide');
  if (!text) {
    return [];
  }

  return [...parseVehicleDefs(text).keys()].sort((a, b) => a.localeCompare(b));
}
