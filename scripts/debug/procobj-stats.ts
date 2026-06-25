import type { MapDefinitions } from '@opensa/renderware/parsers/text/types';

import { buildCellColliders } from '@opensa/renderware/collision/build-cell-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { groupRulesBySurface, PROC_OBJ_MAX_DENSITY, scatterProcObjects } from '@opensa/renderware/map/procobj-scatter';
import { buildWorldGrid } from '@opensa/renderware/map/world-grid';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '@opensa/renderware/parsers/text/surfinfo.parser';
import { readFileSync } from 'node:fs';

import { gameArg, gameDir, loadMapDefs, openGameArchive, positionalArgs } from '../lib/game';

/**
 * procobj scatter sanity counts for one cell (plan 042, iteration 3c): how many clutter
 * instances would the scatter generate at a world position — per model, per category, and at
 * vanilla density vs the full headroom. Mirrors `resolveMap` offline (fs + the real archive).
 * Run: `npx tsx scripts/debug/procobj-stats.ts <x> <y> [--game original]` (desert `-450 1500`; sea `-900 -1900`).
 */
const CELL_SIZE = 250; // keep in sync with canvas-host's CELL_SIZE
const game = gameArg();
const [xArg, yArg] = positionalArgs();
const targetX = Number(xArg);
const targetY = Number(yArg);
if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
  console.error('usage: npx tsx scripts/debug/procobj-stats.ts <x> <y> [--game original]');
  process.exit(1);
}

const archive = openGameArchive(game);
const { catalog, instances } = loadMapDefs(game, archive);
const defs: MapDefinitions = { catalog, imgDirs: [], instances, timedCatalog: new Map() };
const grid = buildWorldGrid(defs, CELL_SIZE);

const rules = groupRulesBySurface(parseProcObj(readFileSync(gameDir(game, 'data', 'procobj.dat'), 'utf8')));
const surfaceNames = parseSurfaceNames(readFileSync(gameDir(game, 'data', 'surfinfo.dat'), 'utf8'));

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
