import { parseDff } from '../../src/renderware/parsers/binary/dff';
import { parseTxd } from '../../src/renderware/parsers/binary/txd';
import { isLodModel } from '../../src/renderware/parsers/text/lod';
import { gameArg, loadMapDefs, openGameArchive, positionalArgs } from '../lib/game';

/**
 * Area inspector for "model missing / black / not picked" bugs: lists every map instance within a
 * radius of a point, with WHY it would (not) render — def present, LOD class, interior, DFF in the
 * archive, parse result, TXD presence. Mirrors `resolveMap` offline (fs + the real archive).
 * Run: `npx tsx scripts/debug/inspect-area.ts <x> <y> [radius=120] [--game original]`.
 */
const game = gameArg();
const [xArg, yArg, radiusArg] = positionalArgs();
const targetX = Number(xArg);
const targetY = Number(yArg);
const radius = Number(radiusArg ?? 120);
if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
  console.error('usage: npx tsx scripts/debug/inspect-area.ts <x> <y> [radius] [--game original]');
  process.exit(1);
}

const archive = openGameArchive(game);
const { catalog, instances } = loadMapDefs(game, archive);

console.log(`instances total: ${instances.length}; scanning ${radius}u around (${targetX}, ${targetY})\n`);
const near = instances.filter((instance) => {
  const dx = instance.position[0] - targetX;
  const dy = instance.position[1] - targetY;

  return dx * dx + dy * dy <= radius * radius;
});
near.sort((a, b) => a.position[0] - b.position[0]);

for (const instance of near) {
  const def = catalog.get(instance.id);
  const pos = instance.position.map((v) => v.toFixed(1)).join(', ');
  if (!def) {
    console.log(`id ${instance.id} @ (${pos}) [${instance.from}] — NO DEF IN CATALOG`);
    continue;
  }
  const lodTag = isLodModel(def.modelName) ? ' LOD-model' : '';
  const interiorTag = instance.interior === 0 ? '' : ` interior=${instance.interior}`;
  const dff = archive.get(`${def.modelName.toLowerCase()}.dff`);
  let parsed = 'NO DFF IN ARCHIVE';
  if (dff) {
    try {
      const clump = parseDff(dff);
      const tris = clump.geometries.reduce((sum, geometry) => sum + geometry.triangles.length, 0);
      parsed = `dff ok: ${clump.atomics.length} atomics, ${tris} tris`;
      if (clump.atomics.length === 0 || tris === 0) {
        parsed = `dff EMPTY (${clump.atomics.length} atomics, ${tris} tris)`;
      }
    } catch (error) {
      parsed = `dff PARSE FAILED: ${String(error)}`;
    }
  }
  let txd = 'NO TXD IN ARCHIVE';
  const txdBuffer = archive.get(`${def.txdName.toLowerCase()}.txd`);
  if (txdBuffer) {
    try {
      txd = `txd ok (${parseTxd(txdBuffer).textures.length} tex)`;
    } catch (error) {
      txd = `txd PARSE FAILED: ${String(error)}`;
    }
  }
  console.log(
    `${def.modelName} (id ${instance.id}, txd ${def.txdName}) @ (${pos}) [${instance.from}] lod-link=${instance.lod}${lodTag}${interiorTag}\n  ${parsed}; ${txd}`,
  );
}
console.log(`\n${near.length} instances in range`);
