import type { MapDefinitions } from '@opensa/renderware/parsers/text/types';

import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { gameArg, loadMapDefs, openGameArchive, positionalArgs } from '../lib/game';

/**
 * Reproduce the cell build's roadsign path offline (plan 042 item 5 debugging): for a world
 * position, list the HD cell's model groups, parse each clump from the real archive, and
 * report which carry 2dfx roadsign entries — pinpoints where a missing sign drops out.
 * Run: `npx tsx scripts/debug/check-cell-signs.ts <x> <y> [--game original]`.
 */
const CELL_SIZE = 250;
const game = gameArg();
const [xArg, yArg] = positionalArgs();
const targetX = Number(xArg);
const targetY = Number(yArg);
if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
  console.error('usage: npx tsx scripts/debug/check-cell-signs.ts <x> <y> [--game original]');
  process.exit(1);
}

const archive = openGameArchive(game);
const { catalog, instances } = loadMapDefs(game, archive);
const defs: MapDefinitions = { catalog, imgDirs: [], instances, timedCatalog: new Map() };
const grid = buildWorldGrid(defs, CELL_SIZE);

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
  const def = catalog.get(instance.id);
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
