import type { AssetFileSystem } from '@opensa/renderware/archive';

import { mergeCarcols, mergeHandling, mergeIde } from './merge';
import { scanModloader } from './scan';

const VEHICLES_IDE = 'data/vehicles.ide';
const HANDLING_CFG = 'data/handling.cfg';
const CARCOLS_DAT = 'data/carcols.dat';

/**
 * Wrap an {@link AssetFileSystem} so a `modloader/` overlay takes effect, **without changing the engine**: every
 * `.dff`/`.txd` under `modloader/` (at any depth — the folder layout is irrelevant) is served under its bare file
 * name, shadowing the same-named stock asset the vehicle loader reads from gta3.img; each `*.settings.txt` is merged
 * into `vehicles.ide` / `handling.cfg` / `carcols.dat` (the text the engine parses). Everything else passes through.
 * The overlay is computed once (the VFS is already populated + synchronous), so reads stay O(1).
 */
export function withModloader(fs: AssetFileSystem): AssetFileSystem {
  const { overrides, settings } = scanModloader(fs);
  if (overrides.size === 0 && settings.length === 0) {
    return fs;
  }

  const ideLines: string[] = [];
  const handlingLines: string[] = [];
  const carcolsLines: string[] = [];
  for (const setting of settings) {
    if (setting.ideLine) {
      ideLines.push(setting.ideLine);
    }
    if (setting.handlingLine) {
      handlingLines.push(setting.handlingLine);
    }
    if (setting.carcolsLine) {
      carcolsLines.push(setting.carcolsLine);
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
    get: (name): ArrayBuffer | null => overrides.get(name.toLowerCase()) ?? fs.get(name),
    getText: (name): null | string => text.get(name) ?? fs.getText(name),
    has: (name): boolean => overrides.has(name.toLowerCase()) || fs.has(name),
    get names(): string[] {
      return [...new Set([...fs.names, ...overrides.keys()])];
    },
  };
}
