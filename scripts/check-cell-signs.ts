import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openArchive } from '../src/renderware/archive/img-archive';
import { datChildUrl, iplBasename, streamIplUrl } from '../src/renderware/archive/resolve-paths';
import { buildWorldGrid, cellKey } from '../src/renderware/map/world-grid';
import { parseDff } from '../src/renderware/parsers/binary/dff';
import { parseGtaDat } from '../src/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '../src/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '../src/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '../src/renderware/parsers/text/ipl.parser';

import type { IdeObjectDef, IplInstance, MapDefinitions } from '../src/renderware/parsers/text/types';

/**
 * Reproduce the cell build's roadsign path offline (plan 042 item 5 debugging): for a world
 * position, list the HD cell's model groups, parse each clump from the PLAYED archive, and
 * report which carry 2dfx roadsign entries — pinpoints where a missing sign drops out.
 * Run: `npx tsx scripts/check-cell-signs.ts <x> <y> [imgPath=static/models/gta3-pf.img]`.
 */
const ROOT = join(import.meta.dirname, '..');
const BASE = join(ROOT, 'static');
const CELL_SIZE = 250;
const [xArg, yArg, imgArg] = process.argv.slice(2);
const targetX = Number(xArg);
const targetY = Number(yArg);
if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
  console.error('usage: npx tsx scripts/check-cell-signs.ts <x> <y> [imgPath]');
  process.exit(1);
}

const dat = parseGtaDat(readFileSync(join(BASE, 'data', 'gta.dat'), 'utf8'));
const catalog = new Map<number, IdeObjectDef>();
const timedCatalog = new Map<number, IdeObjectDef>();
for (const idePath of dat.ide) {
  const file = datChildUrl(BASE, idePath);
  if (!existsSync(file)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  for (const def of parseIde(text)) {
    catalog.set(def.id, def);
  }
  for (const def of parseTimedObjects(text)) {
    timedCatalog.set(def.id, def);
  }
}

const manifest = JSON.parse(readFileSync(join(BASE, 'ipl_binary', 'manifest.json'), 'utf8')) as Record<string, number>;
const instances: IplInstance[] = [];
for (const iplPath of dat.ipl) {
  if (iplPath.toLowerCase().endsWith('.zon')) {
    continue;
  }
  const file = datChildUrl(BASE, iplPath);
  if (existsSync(file)) {
    instances.push(...parseIpl(readFileSync(file, 'utf8')));
  }
  const basename = iplBasename(iplPath);
  for (let index = 0; index < (manifest[basename] ?? 0); index += 1) {
    const stream = streamIplUrl(BASE, basename, index);
    if (!existsSync(stream)) {
      continue;
    }
    const buffer = readFileSync(stream);
    instances.push(...parseBinaryIpl(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)));
  }
}

const defs: MapDefinitions = { catalog, imgDirs: [], instances, timedCatalog };
const grid = buildWorldGrid(defs, CELL_SIZE);
const archive = openArchive(new Uint8Array(readFileSync(join(ROOT, imgArg ?? 'static/models/gta3-pf.img'))));

const cx = Math.floor(targetX / CELL_SIZE);
const cy = Math.floor(targetY / CELL_SIZE);
const cell = grid.get(cellKey(cx, cy));
if (!cell) {
  console.log(`cell (${cx}, ${cy}) not in grid`);
  process.exit(0);
}
console.log(`cell (${cx}, ${cy}): ${cell.hd.length} HD instances, ${cell.lod.length} LOD`);

const seen = new Set<string>();
for (const instance of cell.hd) {
  const def = catalog.get(instance.id) ?? timedCatalog.get(instance.id);
  if (!def || seen.has(def.modelName.toLowerCase())) {
    continue;
  }
  seen.add(def.modelName.toLowerCase());
  const buffer = archive.get(`${def.modelName.toLowerCase()}.dff`);
  if (!buffer) {
    console.log(`  ${def.modelName}: DFF MISSING in archive`);
    continue;
  }
  try {
    const clump = parseDff(buffer);
    const roadsigns = clump.geometries.flatMap((geometry) => geometry.roadsigns ?? []);
    if (roadsigns.length > 0) {
      for (const sign of roadsigns) {
        console.log(
          `  ${def.modelName}: SIGN pos(${sign.position.map((v) => v.toFixed(1)).join(',')}) lines=[${sign.lines.join(' / ')}]`,
        );
      }
    }
  } catch (error) {
    console.log(`  ${def.modelName}: PARSE FAILED — ${(error as Error).message}`);
  }
}
console.log('scan done');
