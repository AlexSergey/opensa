import type { AssetFileSystem } from '@opensa/renderware/archive';

import { parseVehicleSettings, type VehicleSettings } from './settings';

/** The overlay a `modloader/` tree contributes: bare-name asset overrides + parsed settings lines. */
export interface ModloaderScan {
  /** Asset overrides keyed by bare lowercased file name (e.g. `admiral.dff`) — shadows the same-named game asset. */
  overrides: Map<string, ArrayBuffer>;
  /** One parsed `*.settings.txt` per file found (its lines merge into vehicles.ide/handling.cfg/carcols.dat). */
  settings: VehicleSettings[];
}

const PREFIX = 'modloader/';

/**
 * Scan the VFS for a `modloader/` overlay. The folder structure is irrelevant — like the real Modloader, a file may
 * sit at the root of `modloader/` or nested any number of levels deep. Every `.dff`/`.txd` becomes an override keyed
 * by its bare file name (the in-game asset it replaces, so a mod's `<file>.txd` wins by name regardless of folder),
 * and every `.txt` is parsed for vehicles.ide / handling.cfg / carcols.dat lines.
 */
export function scanModloader(fs: AssetFileSystem): ModloaderScan {
  const overrides = new Map<string, ArrayBuffer>();
  const settings: VehicleSettings[] = [];
  for (const name of fs.names) {
    const lower = name.toLowerCase();
    if (!lower.startsWith(PREFIX)) {
      continue;
    }
    if (lower.endsWith('.dff') || lower.endsWith('.txd')) {
      const bytes = fs.get(name);
      if (bytes) {
        overrides.set(baseName(lower), bytes);
      }
    } else if (lower.endsWith('.txt')) {
      const text = fs.getText(name);
      if (text) {
        settings.push(parseVehicleSettings(text));
      }
    }
  }

  return { overrides, settings };
}

/** Last path segment (the bare file name) — `path` is already lowercased by the caller. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
