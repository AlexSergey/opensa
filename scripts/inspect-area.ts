import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openArchive } from '../src/renderware/archive/img-archive';
import { datChildUrl, iplBasename, streamIplUrl } from '../src/renderware/archive/resolve-paths';
import { parseDff } from '../src/renderware/parsers/binary/dff';
import { parseTxd } from '../src/renderware/parsers/binary/txd';
import { parseGtaDat } from '../src/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '../src/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '../src/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '../src/renderware/parsers/text/ipl.parser';
import { isLodModel } from '../src/renderware/parsers/text/lod';

/**
 * Area inspector for "model missing / black / not picked" bugs: lists every map instance within a
 * radius of a point, with WHY it would (not) render — def present, LOD class, interior, DFF in the
 * archive, parse result, TXD presence. Mirrors `resolveMap` offline (fs instead of fetch).
 * Run: `npx tsx scripts/inspect-area.ts <x> <y> [radius=120]`.
 */
const ROOT = join(import.meta.dirname, '..');
const BASE = join(ROOT, 'static');
const [xArg, yArg, radiusArg] = process.argv.slice(2);
const targetX = Number(xArg);
const targetY = Number(yArg);
const radius = Number(radiusArg ?? 120);
if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
  console.error('usage: npx tsx scripts/inspect-area.ts <x> <y> [radius]');
  process.exit(1);
}

const dat = parseGtaDat(readFileSync(join(BASE, 'data', 'gta.dat'), 'utf8'));

const catalog = new Map<number, { flags: number; modelName: string; txdName: string }>();
for (const idePath of dat.ide) {
  const file = datChildUrl(BASE, idePath);
  if (!existsSync(file)) {
    continue;
  }
  const text = readFileSync(file, 'utf8');
  for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
    catalog.set(def.id, def);
  }
}

const manifest = JSON.parse(readFileSync(join(BASE, 'ipl_binary', 'manifest.json'), 'utf8')) as Record<string, number>;
const instances: { from: string; id: number; interior: number; lod: number; position: [number, number, number] }[] = [];
for (const iplPath of dat.ipl) {
  if (iplPath.toLowerCase().endsWith('.zon')) {
    continue;
  }
  const file = datChildUrl(BASE, iplPath);
  if (existsSync(file)) {
    for (const instance of parseIpl(readFileSync(file, 'utf8'))) {
      instances.push({ from: iplBasename(iplPath), ...instance });
    }
  }
  const basename = iplBasename(iplPath);
  for (let index = 0; index < (manifest[basename] ?? 0); index += 1) {
    const stream = streamIplUrl(BASE, basename, index);
    if (!existsSync(stream)) {
      continue;
    }
    const buffer = readFileSync(stream);
    for (const instance of parseBinaryIpl(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    )) {
      instances.push({ from: `${basename}_stream${index}`, ...instance });
    }
  }
}

const archive = openArchive(new Uint8Array(readFileSync(join(BASE, 'models', 'gta3-pf.img'))));

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
