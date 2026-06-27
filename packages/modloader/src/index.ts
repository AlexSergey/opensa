import type { AssetFileSystem } from '@opensa/renderware/archive';

import { mergeCarcols, mergeHandling, mergeIde } from './merge';
import { scanVehicles } from './scan';

const VEHICLES_IDE = 'data/vehicles.ide';
const HANDLING_CFG = 'data/handling.cfg';
const CARCOLS_DAT = 'data/carcols.dat';

/**
 * Wrap an {@link AssetFileSystem} so a `modloader/vehicles/` overlay takes effect, **without changing the engine**:
 * each mod's `<model>.dff` / `.txd` is served under `vehicles/<model>.*` (the path the vehicle loader tries first,
 * overriding the stock gta3.img model), and its `*.settings.txt` lines are merged into `vehicles.ide` /
 * `handling.cfg` / `carcols.dat` (the text the engine reads + parses). Everything else passes through. The overlay
 * is computed once (the VFS is already populated + synchronous), so reads stay O(1).
 */
export function withModloader(fs: AssetFileSystem): AssetFileSystem {
  const mods = scanVehicles(fs);
  if (mods.length === 0) {
    return fs;
  }

  const overrides = new Map<string, ArrayBuffer>();
  const ideLines: string[] = [];
  const handlingLines: string[] = [];
  const carcolsLines: string[] = [];
  for (const mod of mods) {
    if (mod.dff) {
      overrides.set(`vehicles/${mod.model}.dff`, mod.dff);
    }
    if (mod.txd) {
      overrides.set(`vehicles/${mod.model}.txd`, mod.txd);
    }
    if (mod.settings?.ideLine) {
      ideLines.push(mod.settings.ideLine);
    }
    if (mod.settings?.handlingLine) {
      handlingLines.push(mod.settings.handlingLine);
    }
    if (mod.settings?.carcolsLine) {
      carcolsLines.push(mod.settings.carcolsLine);
    }
  }

  const text = new Map<string, string>();
  if (ideLines.length > 0) {
    text.set(VEHICLES_IDE, mergeIde(fs.getText(VEHICLES_IDE) ?? '', ideLines));
  }
  if (handlingLines.length > 0) {
    text.set(HANDLING_CFG, mergeHandling(fs.getText(HANDLING_CFG) ?? '', handlingLines));
  }
  if (carcolsLines.length > 0) {
    text.set(CARCOLS_DAT, mergeCarcols(fs.getText(CARCOLS_DAT) ?? '', carcolsLines));
  }

  return {
    get: (name): ArrayBuffer | null => overrides.get(name) ?? fs.get(name),
    getText: (name): null | string => text.get(name) ?? fs.getText(name),
    has: (name): boolean => overrides.has(name) || fs.has(name),
    get names(): string[] {
      return [...new Set([...fs.names, ...overrides.keys()])];
    },
  };
}
