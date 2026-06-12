import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IdeObjectDef, IplInstance, MapDefinitions } from '../src/renderware/parsers/text/types';

import { openArchive } from '../src/renderware/archive/img-archive';
import { datChildUrl, iplBasename, streamIplUrl } from '../src/renderware/archive/resolve-paths';
import { buildCellColliders } from '../src/renderware/collision/build-cell-colliders';
import { buildCollisionIndex } from '../src/renderware/collision/collision-index';
import { groupRulesBySurface, PROC_OBJ_MAX_DENSITY, scatterProcObjects } from '../src/renderware/map/procobj-scatter';
import { buildWorldGrid } from '../src/renderware/map/world-grid';
import { parseGtaDat } from '../src/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '../src/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '../src/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '../src/renderware/parsers/text/ipl.parser';
import { parseProcObj } from '../src/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '../src/renderware/parsers/text/surfinfo.parser';

/**
 * procobj scatter sanity counts for one cell (plan 042, iteration 3c): how many clutter
 * instances would the scatter generate at a world position — per model, per category, and at
 * vanilla density vs the full headroom. Mirrors `resolveMap` offline (fs instead of fetch).
 * Run: `npx tsx scripts/procobj-stats.ts <x> <y>` (e.g. desert: `-450 1500`; sea floor: `-900 -1900`).
 */
const ROOT = join(import.meta.dirname, '..');
const BASE = join(ROOT, 'static');
const CELL_SIZE = 250; // keep in sync with canvas-host's CELL_SIZE
const [xArg, yArg] = process.argv.slice(2);
const targetX = Number(xArg);
const targetY = Number(yArg);
if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
  console.error('usage: npx tsx scripts/procobj-stats.ts <x> <y>');
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
const archive = openArchive(new Uint8Array(readFileSync(join(BASE, 'models', 'gta3-pf.img'))));

const rules = groupRulesBySurface(parseProcObj(readFileSync(join(BASE, 'data', 'procobj.dat'), 'utf8')));
const surfaceNames = parseSurfaceNames(readFileSync(join(BASE, 'data', 'surfinfo.dat'), 'utf8'));

const cx = Math.floor(targetX / CELL_SIZE);
const cy = Math.floor(targetY / CELL_SIZE);
console.log(`cell (${cx}, ${cy}) around (${targetX}, ${targetY})`);

const colliders = buildCellColliders(buildCollisionIndex(archive), defs, grid, cx, cy);
console.log(`colliders: ${colliders.length} models in cell`);

// Area-weighted surface histogram: which surfaces exist here, their COL material ids, whether
// procobj rules match, and which model contributes the most area (diagnoses wrong-zone scatter).
{
  const bySurface = new Map<number, { area: number; byModel: Map<string, number> }>();
  for (const collider of colliders) {
    const { faces, vertices } = collider.col;
    const placements = collider.transforms.length; // rigid transforms — face area is invariant
    for (const face of faces) {
      const ax = vertices[face.a * 3];
      const ay = vertices[face.a * 3 + 1];
      const az = vertices[face.a * 3 + 2];
      const ux = vertices[face.b * 3] - ax;
      const uy = vertices[face.b * 3 + 1] - ay;
      const uz = vertices[face.b * 3 + 2] - az;
      const vx = vertices[face.c * 3] - ax;
      const vy = vertices[face.c * 3 + 1] - ay;
      const vz = vertices[face.c * 3 + 2] - az;
      const cxn = uy * vz - uz * vy;
      const cyn = uz * vx - ux * vz;
      const czn = ux * vy - uy * vx;
      const area = (Math.hypot(cxn, cyn, czn) / 2) * placements;
      const stats = bySurface.get(face.material) ?? { area: 0, byModel: new Map<string, number>() };
      stats.area += area;
      stats.byModel.set(collider.name, (stats.byModel.get(collider.name) ?? 0) + area);
      bySurface.set(face.material, stats);
    }
  }
  console.log('\nsurface histogram (area-weighted):');
  const sorted = [...bySurface.entries()].sort((a, b) => b[1].area - a[1].area);
  for (const [material, stats] of sorted.slice(0, 20)) {
    const name = surfaceNames[material] ?? '???';
    const matched = rules.has(name) ? `rules ×${rules.get(name)?.length}` : '-';
    const top = [...stats.byModel.entries()].sort((a, b) => b[1] - a[1])[0];
    console.log(
      `  id ${String(material).padStart(3)} ${name.padEnd(22)} ${Math.round(stats.area).toString().padStart(8)} m²  ${matched.padEnd(9)} top: ${top[0]} (${Math.round(top[1])} m²)`,
    );
  }
}

const batches = scatterProcObjects(colliders, rules, surfaceNames, cx, cy);
const byCategory = new Map<string, { full: number; vanilla: number }>();
let totalFull = 0;
let totalVanilla = 0;
for (const batch of batches) {
  const vanilla = batch.placements.filter((placement) => placement.lottery < 1).length;
  const stats = byCategory.get(batch.category) ?? { full: 0, vanilla: 0 };
  stats.full += batch.placements.length;
  stats.vanilla += vanilla;
  byCategory.set(batch.category, stats);
  totalFull += batch.placements.length;
  totalVanilla += vanilla;
  console.log(
    `  ${batch.model.padEnd(20)} [${batch.category.padEnd(10)}] vanilla ${String(vanilla).padStart(5)} / capacity ${batch.placements.length}`,
  );
}
console.log('\nper category:');
for (const [category, stats] of byCategory) {
  console.log(`  ${category.padEnd(10)} vanilla ${String(stats.vanilla).padStart(6)} / capacity ${stats.full}`);
}
console.log(`\nTOTAL vanilla ${totalVanilla} / capacity ${totalFull} (max density ${PROC_OBJ_MAX_DENSITY})`);
