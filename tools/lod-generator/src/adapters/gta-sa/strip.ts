import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { stripBinaryIpl } from '@opensa/map-placement/ipl-binary-strip';
import { stripTextIpl } from '@opensa/map-placement/ipl-text-strip';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { isInterior } from '@opensa/renderware/parsers/text/interior';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { isLodModel } from '@opensa/renderware/parsers/text/lod';
import { editArchive } from '@opensa/tool-kit/archive/img';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type GtaDat = ReturnType<typeof parseGtaDat>;

/**
 * Strip the stock `lod*` building/terrain LODs from a finished build — the cell-LODs replace that far-LOD layer,
 * so the old per-object LODs are dead weight. Removes their instances from the text IPLs and the binary streams in
 * `models/gta3.img` (repairing the shared text↔binary `lod`-index space), then deletes their `.dff`/`.txd` from
 * `gta3.img`.
 *
 * **A model is a stock LOD only when it is `lod*`-named, placed in the *exterior* world, and never placed inside an
 * interior.** The name alone is unreliable — `LODCJ_SLOT_BANK` is a real casino-*interior* prop, not a LOD, so it
 * (and any `lod*`-named model with an interior placement) is kept. Conversely, standalone exterior LODs (placed
 * directly, never pointed to by a `lod` index — e.g. `LODmcstraps_LAe2`) *are* stripped; an earlier "must be a
 * `lod`-target" rule wrongly kept those. The **same** `isOldLod` predicate gates instance-removal *and*
 * DFF-deletion, so a deleted model can't have surviving instances (no dangling refs). The cell-LOD `lods.*`
 * assets are `lod*`-named too, so they're skipped. IDE defs are left as-is. Returns the removed counts.
 */
export function stripOldLods(buildDir: string): { entries: number; instances: number } {
  const dat = parseGtaDat(readFileSync(join(buildDir, 'data', 'gta.dat'), 'utf8'));
  const imgPath = join(buildDir, 'models', 'gta3.img');
  const archive = openArchive(readBytes(imgPath));

  const idToModel = idToModelMap(buildDir, dat);
  const { interiorModels, lodExterior } = classifyPlacements(buildDir, dat, archive, idToModel);
  const isOldLod = (name: string): boolean => {
    const model = name.toLowerCase();

    return lodExterior.has(model) && !interiorModels.has(model);
  };
  const lodIds = new Set([...idToModel].filter(([, model]) => isOldLod(model)).map(([id]) => id));

  // Text IPLs first: each area's removal map is the LOD-index space its binary streams point into.
  const maps = new Map<string, Int32Array>();
  let instances = 0;
  for (const iplPath of dat.ipl) {
    const file = datChildUrl(buildDir, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || isCellLodFile(iplPath) || !existsSync(file)) {
      continue;
    }
    const result = stripTextIpl(readFileSync(file, 'utf8'), (_id, name) => !isOldLod(name));
    if (result.removed > 0) {
      writeFileSync(file, result.text);
      maps.set(areaKey(iplPath), result.map);
      instances += result.removed;
    }
  }

  // Binary streams inside gta3.img: drop lod* insts + remap survivors' `lod` via the area map; then delete the
  // confirmed-LOD DFF/TXD entries from the archive.
  const img = editArchive(archive);
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    const result = stripBinaryIpl(
      new Uint8Array(archive.get(name) ?? new ArrayBuffer(0)),
      (id) => !lodIds.has(id),
      maps.get(areaKey(name)) ?? null,
    );
    if (result.changed) {
      img.set(name, result.bytes);
      instances += result.removed;
    }
  }
  let entries = 0;
  for (const name of archive.names) {
    if (/\.(?:dff|txd)$/i.test(name) && isOldLod(name.replace(/\.[^.]+$/, '')) && img.delete(name)) {
      entries += 1;
    }
  }
  writeFileSync(imgPath, img.build());

  return { entries, instances };
}

/** Area key shared by a text IPL and its binary streams: `countrye.ipl` & `countrye_stream3.ipl` → `countrye`. */
function areaKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;

  return base
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/**
 * Scan every placement (text IPLs + binary streams) and bucket each model: `interiorModels` = placed in any
 * interior; `lodExterior` = `lod*`-named with at least one exterior placement. A stock LOD to strip is then
 * `lodExterior − interiorModels` (so a dual-role `lod*` name with any interior use is kept whole).
 */
function classifyPlacements(
  buildDir: string,
  dat: GtaDat,
  archive: ImgArchive,
  idToModel: ReadonlyMap<number, string>,
): { interiorModels: Set<string>; lodExterior: Set<string> } {
  const interiorModels = new Set<string>();
  const lodExterior = new Set<string>();
  const note = (model: string | undefined, interior: number): void => {
    if (!model) {
      return;
    }
    if (isInterior(interior)) {
      interiorModels.add(model);
    } else if (isLodModel(model)) {
      lodExterior.add(model);
    }
  };

  for (const iplPath of dat.ipl) {
    const file = datChildUrl(buildDir, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || isCellLodFile(iplPath) || !existsSync(file)) {
      continue;
    }
    for (const inst of parseIpl(readFileSync(file, 'utf8'))) {
      note(inst.modelName.toLowerCase(), inst.interior);
    }
  }
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    for (const inst of parseBinaryIpl(toArrayBuffer(new Uint8Array(archive.get(name) ?? new ArrayBuffer(0))))) {
      note(idToModel.get(inst.id), inst.interior);
    }
  }

  return { interiorModels, lodExterior };
}

/** Object id → model name (lowercased) from every gta.dat IDE except our own `lods.ide`. */
function idToModelMap(buildDir: string, dat: GtaDat): Map<number, string> {
  const map = new Map<number, string>();
  for (const idePath of dat.ide) {
    const file = datChildUrl(buildDir, idePath);
    if (isCellLodFile(idePath) || !existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      map.set(def.id, def.modelName.toLowerCase());
    }
  }

  return map;
}

/** Our own cell-LOD data files (`lods.ide` / `lods.ipl`) — they're `lod*`-named, so must be skipped by the strip. */
function isCellLodFile(path: string): boolean {
  return /(?:^|[\\/])lods\.(?:ide|ipl)$/i.test(path);
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
