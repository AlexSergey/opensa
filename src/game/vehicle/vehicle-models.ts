/**
 * Spawnable vehicle model names from the asset file list — the `vehicles/<model>.dff` basenames
 * (lowercased, deduped, sorted). Lets the debug menu list every car the loaded game ships (each
 * variant has its own `vehicles/` folder) without a hardcoded per-car list.
 */
export function vehicleModelsFromNames(names: readonly string[]): string[] {
  const models = new Set<string>();
  for (const name of names) {
    const match = /^vehicles\/(.+)\.dff$/i.exec(name);
    if (match) {
      models.add(match[1].toLowerCase());
    }
  }

  return [...models].sort((a, b) => a.localeCompare(b));
}
