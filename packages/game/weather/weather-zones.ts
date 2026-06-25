import type { City } from '../zones/city';

/** Region suffixes a weather name can end with (city regions + DESERT, a Countryside sub-region). */
const REGION_SUFFIXES = ['COUNTRYSIDE', 'VEGAS', 'DESERT', 'SF', 'LA'] as const;

/**
 * The weather index for `city` that **keeps the current weather's type**. Tries, in order:
 *   1. `<type>_<city>` — the city's own variant of the current type;
 *   2. `<type>_COUNTRYSIDE` — the type's Countryside variant, so e.g. RAINY stays RAINY (RAINY has no LA/Vegas
 *      variant, so they take RAINY_COUNTRYSIDE; SF keeps its own RAINY_SF via step 1);
 *   3. `SUNNY_<city>` — for types with no analog at all (SMOG / FOGGY / SANDSTORM).
 * The **desert** is special: it only runs clear weather (SANDSTORM is script-triggered, not zone-driven), so
 * EXTRASUNNY keeps `EXTRASUNNY_DESERT` and everything else becomes `SUNNY_DESERT`.
 * Returns the current index unchanged if nothing matches (safety). Pure — `weatherNames` is passed in (the game
 * layer can't import the renderware `WEATHER_NAMES`).
 */
export function weatherForCity(weatherNames: readonly string[], currentIndex: number, city: City): number {
  const type = weatherType(weatherNames[currentIndex] ?? '');
  if (city === 'DESERT') {
    const index = weatherNames.indexOf(type === 'EXTRASUNNY' ? 'EXTRASUNNY_DESERT' : 'SUNNY_DESERT');

    return index >= 0 ? index : currentIndex;
  }
  for (const candidate of [`${type}_${city}`, `${type}_COUNTRYSIDE`, `SUNNY_${city}`]) {
    const index = weatherNames.indexOf(candidate);
    if (index >= 0) {
      return index;
    }
  }

  return currentIndex;
}

/** The weather "type" — its name minus the trailing region suffix (EXTRASUNNY_SMOG_LA → EXTRASUNNY_SMOG). */
function weatherType(name: string): string {
  for (const region of REGION_SUFFIXES) {
    if (name.endsWith(`_${region}`)) {
      return name.slice(0, -(region.length + 1));
    }
  }

  return name; // specials (UNDERWATER / EXTRACOLOURS_*) — no region suffix
}
