import type { AssetFileSystem } from '@opensa/renderware/archive';

import { ADDITIVE_DAT, mergeDataFile } from './data-merge';
import { mergeCarcols, mergeGtaDat, mergeHandling, mergeIde } from './merge';
import { scanModloader } from './scan';

const VEHICLES_IDE = 'data/vehicles.ide';
const HANDLING_CFG = 'data/handling.cfg';
const CARCOLS_DAT = 'data/carcols.dat';
const GTA_DAT = 'data/gta.dat';

/**
 * Wrap an {@link AssetFileSystem} so a `modloader/` overlay takes effect, **without changing the engine**. Two kinds
 * of mod are supported, both folder-layout- and loader-filename-agnostic (files match by bare name, at any depth):
 *
 * - **Vehicle mods** — `<model>.dff`/`.txd` shadow the stock asset by name; each `*.settings.txt` is merged into
 *   `vehicles.ide` / `handling.cfg` / `carcols.dat` (the text the engine parses).
 * - **Map/asset mods** (e.g. `lod-trees`/`lod-procobj` `--modloader` output, "Project Props", LOD/BSOR Vegetation) —
 *   a loader file's `IDE`/`IPL` lines are merged into `data/gta.dat`, so `resolveMap` loads the mod's new object
 *   defs, `txdp` parents and placements; new/modified IDEs, text IPLs, binary `_stream` IPLs, `.col` and `.dff`/
 *   `.txd` are all served by bare name (a modified stock IPL/stream shadows its original; `.col` is auto-discovered
 *   by `buildCollisionIndex`). `COLFILE` lines are ignored — collision is found from the `.col` itself.
 *
 * Everything else passes through. The overlay is computed once (the VFS is already populated + synchronous), so
 * reads stay O(1). Returns the original fs unchanged when there's no overlay.
 */
export function withModloader(fs: AssetFileSystem): AssetFileSystem {
  const { assets, dataMerges, mapRefs, settings, texts } = scanModloader(fs);

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

  const merged = new Map<string, string>();
  if (ideLines.length > 0) {
    merged.set(VEHICLES_IDE, mergeIde(fs.getText(VEHICLES_IDE) ?? '', ideLines));
  }
  if (handlingLines.length > 0) {
    merged.set(HANDLING_CFG, mergeHandling(fs.getText(HANDLING_CFG) ?? '', handlingLines));
  }
  if (carcolsLines.length > 0) {
    merged.set(CARCOLS_DAT, mergeCarcols(fs.getText(CARCOLS_DAT) ?? '', carcolsLines));
  }
  if (mapRefs.ide.length > 0 || mapRefs.ipl.length > 0) {
    const dat = fs.getText(GTA_DAT);
    if (dat !== null) {
      merged.set(GTA_DAT, mergeGtaDat(dat, mapRefs));
    }
  }
  for (const [base, additions] of dataMerges) {
    const path = `data/${base}`; // object.dat / procobj.dat — additively merged onto stock (keep + add/replace rows)
    merged.set(path, mergeDataFile(fs.getText(path) ?? '', additions, ADDITIVE_DAT[base]));
  }

  if (assets.size === 0 && texts.size === 0 && merged.size === 0) {
    return fs;
  }

  return {
    get: (name): ArrayBuffer | null => assets.get(baseName(name)) ?? fs.get(name),
    getText: (name): null | string => merged.get(name) ?? texts.get(baseName(name)) ?? fs.getText(name),
    has: (name): boolean => merged.has(name) || assets.has(baseName(name)) || texts.has(baseName(name)) || fs.has(name),
    get names(): string[] {
      return [...new Set([...fs.names, ...assets.keys()])];
    },
  };
}

/** Bare lowercased file name of a VFS key / engine read path (e.g. `data/maps/lodtrees.ide` → `lodtrees.ide`). */
function baseName(name: string): string {
  const lower = name.toLowerCase();

  return lower.slice(lower.lastIndexOf('/') + 1);
}
