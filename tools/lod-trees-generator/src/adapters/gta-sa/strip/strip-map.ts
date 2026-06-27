import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { stripProcObj } from '@opensa/map-placement/procobj-strip';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { stripBinaryIpl } from './ipl-binary';
import { stripTextIpl } from './ipl-text';

export interface StripOptions {
  /** Tree model names (dff base, no extension) whose placements to remove. */
  dffNames: string[];
  /** Game-data dir (`data/`, `models/gta3.img`). */
  gamePath: string;
  /** Write modified IMG entries loose to `<out>/gta3img/` instead of repacking a full `gta3.img`. */
  loose: boolean;
  outPath: string;
}

type GtaDat = ReturnType<typeof parseGtaDat>;

/**
 * Stage 1 — strip every placement of the `--dff` trees (and their old `lod<name>` LODs) from the map: binary IPL
 * streams in `gta3.img`, text IPLs under `data/`, and `procobj.dat` scatter rules. Emits a drop-in under `--out`
 * (a repacked `gta3.img` by default, or loose entries in `gta3img/` with `loose`), plus the edited data files.
 */
export function stripMap(options: StripOptions): void {
  const { dffNames, gamePath, loose, outPath } = options;
  const treeNames = new Set<string>();
  for (const name of dffNames) {
    treeNames.add(name.toLowerCase());
    treeNames.add(`lod${name.toLowerCase()}`); // the old LOD model
  }

  const dat = parseGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'));
  const treeIds = treeIdSet(gamePath, dat, treeNames);
  const keepId = (id: number): boolean => !treeIds.has(id);

  const archive = openArchive(readBytes(join(gamePath, 'models', 'gta3.img')));
  // Text IPLs first: each area's removal map is the shared LOD-index space its binary streams point into.
  const maps = new Map<string, Int32Array>();
  const textRemoved = stripTextIpls(gamePath, dat, treeNames, keepId, outPath, maps);
  const streams = stripStreams(archive, keepId, maps);
  const procRemoved = stripProcObjFile(gamePath, treeNames, outPath);
  emitImg(archive, streams.edited, loose, outPath);

  console.log(
    `strip: ${dffNames.length} tree models · removed ${streams.removed + textRemoved} instances ` +
      `(${streams.edited.size} streams, binary ${streams.removed} / text ${textRemoved}) · procobj ${procRemoved} ` +
      `→ ${loose ? `${outPath}/gta3img/` : `${outPath}/gta3.img`}`,
  );
}

/** Area key shared by a text IPL and its binary streams: `countrye.ipl` & `countrye_stream3.ipl` → `countrye`. */
function areaKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;

  return base
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/** Loose entries to `<out>/gta3img/`, or a full repacked `<out>/gta3.img`. */
function emitImg(archive: ImgArchive, edited: Map<string, Uint8Array>, loose: boolean, outPath: string): void {
  if (loose) {
    for (const [name, bytes] of edited) {
      writeBytes(join(outPath, 'gta3img', name), bytes);
    }

    return;
  }
  const img = editArchive(archive);
  for (const [name, bytes] of edited) {
    img.set(name, bytes);
  }
  writeBytes(join(outPath, 'gta3.img'), img.build());
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function stripProcObjFile(base: string, treeNames: ReadonlySet<string>, outPath: string): number {
  const proc = stripProcObj(
    readFileSync(join(base, 'data', 'procobj.dat'), 'utf8'),
    (model) => !treeNames.has(model.toLowerCase()),
  );
  if (proc.removed > 0) {
    writeText(join(outPath, 'data', 'procobj.dat'), proc.text);
  }

  return proc.removed;
}

/**
 * Strip every binary IPL stream; a stream's `lod` indexes into its area's text IPL, so it is remapped via that
 * area's `maps` entry (left as-is when the area has no companion text). Returns the modified streams + removed.
 */
function stripStreams(
  archive: ImgArchive,
  keepId: (id: number) => boolean,
  maps: ReadonlyMap<string, Int32Array>,
): { edited: Map<string, Uint8Array>; removed: number } {
  const edited = new Map<string, Uint8Array>();
  let removed = 0;
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    const textMap = maps.get(areaKey(name)) ?? null;
    const result = stripBinaryIpl(new Uint8Array(archive.get(name) ?? new ArrayBuffer(0)), keepId, textMap);
    if (result.changed) {
      edited.set(name, result.bytes);
      removed += result.removed;
    }
  }

  return { edited, removed };
}

/**
 * Strip the gta.dat text IPLs; writes the modified ones under `<out>/<ipl-path>`, records each area's old→new
 * instance map in `maps` (for the binary pass), and returns total removed.
 */
function stripTextIpls(
  base: string,
  dat: GtaDat,
  treeNames: ReadonlySet<string>,
  keepId: (id: number) => boolean,
  outPath: string,
  maps: Map<string, Int32Array>,
): number {
  let removed = 0;
  for (const iplPath of dat.ipl) {
    const file = datChildUrl(base, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || !existsSync(file)) {
      continue;
    }
    const result = stripTextIpl(
      readFileSync(file, 'utf8'),
      (id, name) => keepId(id) && !treeNames.has(name.toLowerCase()),
    );
    if (result.removed > 0) {
      writeText(join(outPath, iplPath.replace(/\\/g, '/')), result.text);
      maps.set(areaKey(iplPath), result.map);
      removed += result.removed;
    }
  }

  return removed;
}

/** Object ids whose model name is in the tree set, from every IDE the gta.dat lists. */
function treeIdSet(base: string, dat: GtaDat, treeNames: ReadonlySet<string>): Set<number> {
  const ids = new Set<number>();
  for (const idePath of dat.ide) {
    const file = datChildUrl(base, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      if (treeNames.has(def.modelName.toLowerCase())) {
        ids.add(def.id);
      }
    }
  }

  return ids;
}

function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
