import type { AssetFileSystem } from '@opensa/renderware/archive';

import { ADDITIVE_DAT } from './data-merge';
import { parseLoader } from './loader';
import { parseVehicleSettings, type VehicleSettings } from './settings';

/** The overlay a `modloader/` tree contributes: bare-name asset/text overrides, loader refs, and vehicle settings. */
export interface ModloaderScan {
  /** Bare-name → bytes for files the engine reads via `get`: `.dff`/`.txd`/`.col`/`.ifp` + binary `_stream` IPLs. */
  assets: Map<string, ArrayBuffer>;
  /** Additively-merged data files (e.g. `object.dat`/`procobj.dat`): bare name → every mod copy, folded onto stock. */
  dataMerges: Map<string, string[]>;
  /** `IDE`/`IPL`/`COLFILE` references collected from every loader file (IDE/IPL merged into `gta.dat`). */
  mapRefs: { col: string[]; ide: string[]; ipl: string[] };
  /** One parsed `*.settings.txt` per vehicle settings file found (merges into vehicles.ide/handling.cfg/carcols.dat). */
  settings: VehicleSettings[];
  /** Bare-name → text for files the engine reads via `getText`: `.ide`, text `.ipl`, and whole-file `.dat` overrides. */
  texts: Map<string, string>;
}

const PREFIX = 'modloader/';
/** A binary IPL stream (`<area>_streamN.ipl`) — bytes the engine reads via `get`, unlike a text (placement) IPL. */
const STREAM_IPL = /_stream\d+\.ipl$/;

/**
 * Scan the VFS for a `modloader/` overlay. The folder structure is irrelevant — like the real Modloader, a file may
 * sit at the root of `modloader/` or nested any number of levels deep, and nothing keys off a folder name. Files are
 * bucketed by **type** and keyed by their **bare name** (the in-game asset they replace / are referenced by):
 * - `.dff`/`.txd`/`.col`/`.ifp` + binary `_stream` IPLs → `assets` (bytes, served via `get`);
 * - `.ide` / text `.ipl` / a whole-file-override `.dat` → `texts` (served via `getText`);
 * - an **additive** `.dat` ({@link ADDITIVE_DAT}: `object.dat`/`procobj.dat`) → `dataMerges` (folded onto stock);
 * - a **loader file** (any `.txt` carrying `IDE`/`IPL`/`COLFILE` directives — name is irrelevant: `loader.txt`,
 *   `Loader.txt`, …) → its refs go to `mapRefs`; a `*.settings.txt` is a vehicle settings file; other `.txt`
 *   (readme / prose, no directives) contributes nothing.
 */
export function scanModloader(fs: AssetFileSystem): ModloaderScan {
  const scan: ModloaderScan = {
    assets: new Map(),
    dataMerges: new Map(),
    mapRefs: { col: [], ide: [], ipl: [] },
    settings: [],
    texts: new Map(),
  };
  for (const name of fs.names) {
    const lower = name.toLowerCase();
    if (lower.startsWith(PREFIX)) {
      bucket(fs, name, lower, scan);
    }
  }

  return scan;
}

/** Last path segment (the bare file name) — `path` is already lowercased by the caller. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Route one `modloader/` file into the {@link ModloaderScan} by type (keyed by its bare name). */
function bucket(fs: AssetFileSystem, name: string, lower: string, scan: ModloaderScan): void {
  const base = baseName(lower);
  if (
    lower.endsWith('.dff') ||
    lower.endsWith('.txd') ||
    lower.endsWith('.col') ||
    lower.endsWith('.ifp') ||
    STREAM_IPL.test(base)
  ) {
    const bytes = fs.get(name);
    if (bytes) {
      scan.assets.set(base, bytes);
    }

    return;
  }
  const text = fs.getText(name);
  if (text === null) {
    return;
  }
  if (base in ADDITIVE_DAT) {
    (scan.dataMerges.get(base) ?? scan.dataMerges.set(base, []).get(base)!).push(text);
  } else if (lower.endsWith('.ipl') || lower.endsWith('.ide') || lower.endsWith('.dat')) {
    scan.texts.set(base, text);
  } else if (lower.endsWith('.settings.txt')) {
    scan.settings.push(parseVehicleSettings(text));
  } else if (lower.endsWith('.txt')) {
    const refs = parseLoader(text); // a loader iff it carries IDE/IPL/COLFILE — else prose/readme, all-empty
    scan.mapRefs.ide.push(...refs.ide);
    scan.mapRefs.ipl.push(...refs.ipl);
    scan.mapRefs.col.push(...refs.col);
  }
}
