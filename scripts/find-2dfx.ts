import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { openArchive } from '../src/renderware/archive/img-archive';

/**
 * Scan DFFs for 2d Effect (0x0253F2F8) entries: histogram the entry types across the map and
 * decode every ROADSIGN (type 7) entry — model, raw flags, text lines. Groundwork for plan 042
 * item 5 (street-name plates rendered from the `roadsignfont` glyph atlas).
 * Run: `npx tsx scripts/find-2dfx.ts` (extracted dirs — the PF sources) or
 * `npx tsx scripts/find-2dfx.ts --img static/models/gta3-original.img` (inside an archive) —
 * diffing the two exposes PF re-export damage to the entries.
 */
const ROOT = join(import.meta.dirname, '..');
const DIRS = ['static/img/gta3', 'static/img/gta3additional'];
const TWO_D_EFFECT = 0x0253f2f8;
const ROADSIGN = 7;

const typeHistogram = new Map<number, number>();
let roadsignModels = 0;

const imgFlag = process.argv.indexOf('--img');
if (imgFlag >= 0 && process.argv[imgFlag + 1]) {
  const archive = openArchive(new Uint8Array(readFileSync(join(ROOT, process.argv[imgFlag + 1]))));
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.dff')) {
      continue;
    }
    const buffer = archive.get(name);
    if (buffer) {
      scan(Buffer.from(buffer), name.replace(/\.dff$/i, ''));
    }
  }
} else {
  for (const dir of DIRS) {
    const base = join(ROOT, dir);
    for (const file of readdirSync(base)) {
      if (!file.toLowerCase().endsWith('.dff')) {
        continue;
      }
      const buffer = readFileSync(join(base, file));
      scan(buffer, file.replace(/\.dff$/i, ''));
    }
  }
}

console.log('\n2dfx entry types across the map:');
for (const [type, count] of [...typeHistogram.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  type ${type}: ${count}`);
}
console.log(`\nmodels with ROADSIGN entries: ${roadsignModels}`);

/** Walk every 2dfx chunk in the raw DFF bytes (no full parse — chunk ids are unique enough).
 *  Byte-stepped: RW chunks are NOT 4-aligned, a 4-byte stride missed real entries. */
function scan(buffer: Buffer, model: string): void {
  let hasRoadsign = false;
  for (let offset = 0; offset + 12 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) !== TWO_D_EFFECT) {
      continue;
    }
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 12;
    if (size < 4 || dataStart + size > buffer.length) {
      continue;
    }
    const count = buffer.readUInt32LE(dataStart);
    if (count > 64) {
      continue; // false positive — implausible entry count
    }
    let cursor = dataStart + 4;
    for (let i = 0; i < count && cursor + 20 <= dataStart + size; i += 1) {
      const entryType = buffer.readUInt32LE(cursor + 12);
      const entrySize = buffer.readUInt32LE(cursor + 16);
      typeHistogram.set(entryType, (typeHistogram.get(entryType) ?? 0) + 1);
      if (entryType === ROADSIGN && cursor + 20 + entrySize <= dataStart + size) {
        hasRoadsign = true;
        dumpRoadsign(buffer, model, cursor);
      }
      cursor += 20 + entrySize;
    }
  }
  if (hasRoadsign) {
    roadsignModels += 1;
  }
}

/** Decode one roadsign entry. Layout (verified against the first survey run — the leading pair
 *  of floats is the PLATE SIZE, not rotation): pos(12) type(4) size(4) | plate vec2(8)
 *  rotation vec3(12) flags u16(2) text 4×16(64) pad(2) = 88 bytes of data. */
function dumpRoadsign(buffer: Buffer, model: string, entryStart: number): void {
  const pos = [buffer.readFloatLE(entryStart), buffer.readFloatLE(entryStart + 4), buffer.readFloatLE(entryStart + 8)];
  const data = entryStart + 20;
  const plate = [buffer.readFloatLE(data), buffer.readFloatLE(data + 4)];
  const rotation = [buffer.readFloatLE(data + 8), buffer.readFloatLE(data + 12), buffer.readFloatLE(data + 16)];
  const flags = buffer.readUInt16LE(data + 20);
  const lines: string[] = [];
  for (let line = 0; line < 4; line += 1) {
    const raw = buffer.subarray(data + 22 + line * 16, data + 22 + (line + 1) * 16);
    const text = raw.toString('latin1').replace(/[_\0]+$/g, '').trimEnd();
    if (text.length > 0) {
      lines.push(text);
    }
  }
  console.log(
    `${model.padEnd(24)} flags 0x${flags.toString(16).padStart(4, '0')} plate(${plate.map((v) => v.toFixed(1)).join('x')}) rot(${rotation.map((v) => v.toFixed(0)).join(',')}) pos(${pos.map((v) => v.toFixed(1)).join(',')}) | ${lines.join(' / ')}`,
  );
}
