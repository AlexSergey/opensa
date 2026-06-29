import type { IplCarGenerator } from '@opensa/renderware';

import type { VehiclePlacement } from '../vehicle/vehicle-lod.system';

/**
 * Convert binary-IPL car generators (SA's map-baked parked/spawned cars) into parked-car
 * {@link VehiclePlacement}s: resolve `id → model` via `modelById` (from `vehicles.ide`), **skipping** random
 * generators (`id = -1`, deferred to cargrp/popcycle — plan 059) and ids with no vehicle definition. Heading is
 * the IPL angle (radians); colour comes from the prim/sec carcols indices, omitted when either channel is random.
 */
export function carGeneratorPlacements(
  generators: readonly IplCarGenerator[],
  modelById: ReadonlyMap<number, string>,
): VehiclePlacement[] {
  const placements: VehiclePlacement[] = [];
  for (const generator of generators) {
    const model = generator.id >= 0 ? modelById.get(generator.id) : undefined;
    if (model === undefined) {
      continue;
    }
    const placement: VehiclePlacement = {
      groundSnap: true,
      heading: generator.angle,
      model,
      position: [...generator.position],
    };
    if (generator.primaryColor >= 0 && generator.secondaryColor >= 0) {
      placement.colour = `${generator.primaryColor},${generator.secondaryColor}`;
    }
    placements.push(placement);
  }

  return placements;
}
