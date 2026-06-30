import { ADDITIVE_DAT, mergeDataFile } from '@opensa/modloader/data-merge';
import { parseLoader } from '@opensa/modloader/loader';
import { mergeGtaDat } from '@opensa/modloader/merge';
import { normalizeDatPath } from '@opensa/renderware/archive';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { injectImgEntries } from './img-merge';

/** A binary IPL stream (`<area>_streamN.ipl`) — bytes injected into gta3.img, unlike a text (placement) IPL. */
const STREAM_IPL = /_stream\d+\.ipl$/;

/** The buckets a Modloader mod's files fall into (keyed by **bare name**, the on-disk path being irrelevant). */
export interface ModScan {
  /** bare name → file path: `.dff`/`.txd`/`.col`/`.ifp` + binary `_stream` IPLs → injected into gta3.img. */
  assets: Map<string, string>;
  /** bare name → file paths: `object.dat`/`procobj.dat` → additively merged onto stock. */
  dataMerges: Map<string, string[]>;
  /** Whether ≥ 1 loader file was found — i.e. this is a Modloader mod (vs a plain path-overlay mod). */
  loaderFound: boolean;
  /** `IDE`/`IPL`/`COLFILE` paths declared across every loader file → `gta.dat` patch + new-file destinations. */
  refs: { col: string[]; ide: string[]; ipl: string[] };
  /** bare name → file path: `.ide` / text `.ipl` / whole-file `.dat` (surfinfo …) → written to disk. */
  texts: Map<string, string>;
}

/**
 * Bake a Modloader-style mod into `outPath` (the accumulated game tree) — the on-disk, persisted equivalent of
 * `@opensa/modloader`'s runtime overlay: patch `gta.dat` with the loader's `IDE`/`IPL` lines, write each `.ide`/
 * `.ipl`/`.dat` to disk (overwrite the stock file by bare name, else the loader-declared path), additively merge
 * `object.dat`/`procobj.dat`, and inject the scattered `.dff`/`.txd`/`.col`/`.ifp` into `models/gta3.img` by name.
 * Returns `{ baked:false }` when the mod has no loader file (caller should use the plain path-overlay instead).
 */
export function bakeMod(modPath: string, outPath: string): { assets: number; baked: boolean; texts: number } {
  const scan = scanModloaderMod(modPath);
  if (!scan.loaderFound) {
    return { assets: 0, baked: false, texts: 0 };
  }

  // 1. Register the loader's defs/placements in gta.dat (COLFILE dropped — col is injected into gta3.img below).
  //    Loader paths come with mixed slashes/case (`DATA\MAPS` vs `data/maps`); canonicalise the appended lines to
  //    the stock convention (backslashes + UPPERCASE directory, filename as-is) so the baked file is consistent.
  //    Dedup keys are normalised by `mergeGtaDat` regardless, and the engine reads any slash/case.
  const datPath = join(outPath, 'data', 'gta.dat');
  if (existsSync(datPath)) {
    const refs = { ide: scan.refs.ide.map(canonicalDatPath), ipl: scan.refs.ipl.map(canonicalDatPath) };
    writeFileSync(datPath, mergeGtaDat(readText(datPath), refs));
  }

  // 2. Place each text file: overwrite the stock file with this bare name, else the loader-declared path.
  const declared = declaredPaths(scan.refs);
  const stock = indexDataFiles(outPath);
  let texts = 0;
  for (const [base, src] of scan.texts) {
    const rel = declared.get(base);
    const dest = stock.get(base) ?? (rel ? join(outPath, rel) : undefined);
    if (dest) {
      writeOut(dest, new Uint8Array(readFileSync(src)));
      texts += 1;
    }
  }

  // 3. Additively merge object.dat / procobj.dat onto stock.
  for (const [base, sources] of scan.dataMerges) {
    const dest = join(outPath, 'data', base);
    const merged = mergeDataFile(existsSync(dest) ? readText(dest) : '', sources.map(readText), ADDITIVE_DAT[base]);
    writeOut(dest, new Uint8Array(Buffer.from(merged)));
  }

  // 4. Inject the scattered model/anim/collision assets into gta3.img by bare name.
  const entries = new Map<string, Uint8Array>();
  for (const [base, src] of scan.assets) {
    entries.set(base, new Uint8Array(readFileSync(src)));
  }
  const assets = injectImgEntries(entries, join(outPath, 'models', 'gta3.img'));

  return { assets, baked: true, texts };
}

/**
 * Scan a `--in` mod subtree (any depth, folder layout irrelevant) and bucket every file by **bare name** the same
 * way `@opensa/modloader` buckets a runtime overlay. `loaderFound` tells {@link bakeMod}/`install` whether to bake
 * (a Modloader mod) or fall back to the plain path-overlay. Vehicle `*.settings.txt`, CLEO `.cs`, and prose `.txt`
 * are ignored.
 */
export function scanModloaderMod(modPath: string): ModScan {
  const scan: ModScan = {
    assets: new Map(),
    dataMerges: new Map(),
    loaderFound: false,
    refs: { col: [], ide: [], ipl: [] },
    texts: new Map(),
  };
  for (const path of walk(modPath)) {
    const lower = path.toLowerCase();
    const base = basename(lower);
    if (
      lower.endsWith('.dff') ||
      lower.endsWith('.txd') ||
      lower.endsWith('.col') ||
      lower.endsWith('.ifp') ||
      STREAM_IPL.test(base)
    ) {
      scan.assets.set(base, path);
    } else if (base in ADDITIVE_DAT) {
      (scan.dataMerges.get(base) ?? scan.dataMerges.set(base, []).get(base)!).push(path);
    } else if (lower.endsWith('.ipl') || lower.endsWith('.ide') || lower.endsWith('.dat')) {
      scan.texts.set(base, path);
    } else if (lower.endsWith('.settings.txt')) {
      // vehicle settings — out of scope for the map baker (handled at runtime by withModloader)
    } else if (lower.endsWith('.txt')) {
      const refs = parseLoader(readText(path));
      if (refs.ide.length > 0 || refs.ipl.length > 0 || refs.col.length > 0) {
        scan.loaderFound = true;
        scan.refs.ide.push(...refs.ide);
        scan.refs.ipl.push(...refs.ipl);
        scan.refs.col.push(...refs.col);
      }
    }
  }

  return scan;
}

/** Canonicalise a gta.dat path to the stock convention: backslashes + UPPERCASE directory (`DATA\MAPS\`), with the
 *  filename left as-authored (matching `DATA\MAPS\LAn.IDE`). The engine reads case-insensitively (OpenSA lowercases
 *  on read; the baker writes the file lowercased), so the displayed case is cosmetic. */
function canonicalDatPath(path: string): string {
  const backslashed = path.replace(/\//g, '\\');
  const slash = backslashed.lastIndexOf('\\');

  return slash < 0 ? backslashed : `${backslashed.slice(0, slash).toUpperCase()}${backslashed.slice(slash)}`;
}

/** Bare name → gta.dat-normalised declared path, from the loader `IDE`/`IPL` refs (where a *new* file is written). */
function declaredPaths(refs: ModScan['refs']): Map<string, string> {
  const paths = new Map<string, string>();
  for (const ref of [...refs.ide, ...refs.ipl]) {
    const normalised = normalizeDatPath(ref);
    paths.set(basename(normalised), normalised);
  }

  return paths;
}

/** Index every loose file under `<out>/data` by bare name → its path (first wins) — to overwrite stock in place. */
function indexDataFiles(outPath: string): Map<string, string> {
  const index = new Map<string, string>();
  const dataDir = join(outPath, 'data');
  if (!existsSync(dataDir)) {
    return index;
  }
  for (const path of walk(dataDir)) {
    const base = basename(path).toLowerCase();
    if (!index.has(base)) {
      index.set(base, path);
    }
  }

  return index;
}

/** BOM-aware text read — some mod loaders/data files ship as UTF-16 (a Notepad-saved `Loader.txt`). */
function readText(path: string): string {
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  return new TextDecoder().decode(bytes);
}

/** Every file under `dir`, recursively (absolute paths). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }

  return out;
}

function writeOut(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
