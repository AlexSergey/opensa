import type { AssetFileSystem } from '@opensa/renderware/archive';

import { parseVehicleSettings, type VehicleSettings } from './settings';

/** One scanned vehicle mod: its model name + replacement bytes + parsed settings (any field may be absent). */
export interface VehicleMod {
  dff?: ArrayBuffer;
  model: string;
  settings?: VehicleSettings;
  txd?: ArrayBuffer;
}

const PREFIX = 'modloader/vehicles/';

/**
 * Scan the VFS for `modloader/vehicles/<subfolder>/` mods: each subfolder ships a `<model>.dff` / `<model>.txd`
 * (the model name is the file's base name) and an optional `*.settings.txt`. Groups files by subfolder so the
 * descriptive folder name (e.g. `admiral - 1976 …`) is irrelevant.
 */
export function scanVehicles(fs: AssetFileSystem): VehicleMod[] {
  const bySubfolder = new Map<string, string[]>();
  for (const name of fs.names) {
    if (!name.toLowerCase().startsWith(PREFIX)) {
      continue;
    }
    const rest = name.slice(PREFIX.length);
    const slash = rest.indexOf('/');
    if (slash < 0) {
      continue; // a stray file directly under modloader/vehicles/ — no subfolder
    }
    const subfolder = rest.slice(0, slash);
    (bySubfolder.get(subfolder) ?? bySubfolder.set(subfolder, []).get(subfolder)!).push(name);
  }

  const mods: VehicleMod[] = [];
  for (const files of bySubfolder.values()) {
    const dff = files.find((f) => f.toLowerCase().endsWith('.dff'));
    const txd = files.find((f) => f.toLowerCase().endsWith('.txd'));
    const settingsFile = files.find((f) => f.toLowerCase().endsWith('.txt'));
    const modelFile = dff ?? txd;
    if (!modelFile) {
      continue; // no model asset — skip
    }
    mods.push({
      dff: dff ? (fs.get(dff) ?? undefined) : undefined,
      model: baseName(modelFile),
      settings: settingsFile ? parseVehicleSettings(fs.getText(settingsFile) ?? '') : undefined,
      txd: txd ? (fs.get(txd) ?? undefined) : undefined,
    });
  }

  return mods;
}

/** Lowercased file base name without the `.dff`/`.txd` extension. */
function baseName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.(?:dff|txd)$/i, '').toLowerCase();
}
