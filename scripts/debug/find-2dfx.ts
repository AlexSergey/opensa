import { openArchive } from '../../src/renderware/archive/img-archive';
import { gameArg, openGameArchive, readBytes } from '../lib/game';

/**
 * Scan DFFs for 2d Effect (0x0253F2F8) entries: histogram the entry types across the map and
 * decode every ROADSIGN (type 7) entry — model, raw flags, text lines. Groundwork for plan 042
 * item 5 (street-name plates rendered from the `roadsignfont` glyph atlas).
 * Run: `npx tsx scripts/debug/find-2dfx.ts [--game original]` (the variant's archive) or
 * `npx tsx scripts/debug/find-2dfx.ts --img <path-to.img>` (a specific archive) —
 * diffing the two exposes re-export damage to the entries.
 */
const TWO_D_EFFECT = 0x0253f2f8;
const PARTICLE = 1;
const ROADSIGN = 7;
const ESCALATOR = 10;

const typeHistogram = new Map<number, number>();
const particleNames = new Map<string, number>();
let roadsignModels = 0;

const imgFlag = process.argv.indexOf('--img');
const archive =
  imgFlag >= 0 && process.argv[imgFlag + 1]
    ? openArchive(readBytes(process.argv[imgFlag + 1]))
    : openGameArchive(gameArg());
for (const name of archive.names) {
  if (!name.toLowerCase().endsWith('.dff')) {
    continue;
  }
  const buffer = archive.get(name);
  if (buffer) {
    scan(Buffer.from(buffer), name.replace(/\.dff$/i, ''));
  }
}

console.log('\n2dfx entry types across the map:');
for (const [type, count] of [...typeHistogram.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  type ${type}: ${count}`);
}
console.log(`\nmodels with ROADSIGN entries: ${roadsignModels}`);
if (particleNames.size > 0) {
  console.log('\nPARTICLE effect names:');
  for (const [name, count] of [...particleNames.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name.padEnd(24)} ${count}`);
  }
}

/** Decode one ESCALATOR entry (gtamods): bottom vec3, top vec3, end vec3, direction u32 = 40 bytes. */
function dumpEscalator(buffer: Buffer, model: string, entryStart: number, entrySize: number): void {
  const vec = (at: number): string =>
    [buffer.readFloatLE(at), buffer.readFloatLE(at + 4), buffer.readFloatLE(at + 8)].map((v) => v.toFixed(2)).join(',');
  const direction = entrySize >= 40 ? buffer.readUInt32LE(entryStart + 20 + 36) : -1;
  console.log(
    `ESCALATOR ${model.padEnd(24)} size=${entrySize} pos(${vec(entryStart)}) bottom(${vec(entryStart + 20)}) top(${vec(entryStart + 32)}) end(${vec(entryStart + 44)}) dir=${direction}`,
  );
}

/** Decode one PARTICLE entry: char[24] effect name + the entry position. */
function dumpParticle(buffer: Buffer, model: string, entryStart: number, entrySize: number): void {
  const name = buffer
    .subarray(entryStart + 20, entryStart + 20 + Math.min(24, entrySize))
    .toString('latin1')
    .replace(/\0.*$/, '');
  particleNames.set(name, (particleNames.get(name) ?? 0) + 1);
  const pos = [buffer.readFloatLE(entryStart), buffer.readFloatLE(entryStart + 4), buffer.readFloatLE(entryStart + 8)];
  console.log(`PARTICLE ${model.padEnd(24)} "${name}" pos(${pos.map((v) => v.toFixed(1)).join(',')})`);
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
    const text = raw
      .toString('latin1')
      .replace(/[_\0]+$/g, '')
      .trimEnd();
    if (text.length > 0) {
      lines.push(text);
    }
  }
  console.log(
    `${model.padEnd(24)} flags 0x${flags.toString(16).padStart(4, '0')} plate(${plate.map((v) => v.toFixed(1)).join('x')}) rot(${rotation.map((v) => v.toFixed(0)).join(',')}) pos(${pos.map((v) => v.toFixed(1)).join(',')}) | ${lines.join(' / ')}`,
  );
}

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
      hasRoadsign = scanEntry(buffer, model, cursor, dataStart + size) || hasRoadsign;
      cursor += 20 + buffer.readUInt32LE(cursor + 16);
    }
  }
  if (hasRoadsign) {
    roadsignModels += 1;
  }
}

/** Histogram + decode one 2dfx entry; returns true when it was a ROADSIGN (model counting). */
function scanEntry(buffer: Buffer, model: string, cursor: number, blockEnd: number): boolean {
  const entryType = buffer.readUInt32LE(cursor + 12);
  const entrySize = buffer.readUInt32LE(cursor + 16);
  typeHistogram.set(entryType, (typeHistogram.get(entryType) ?? 0) + 1);
  if (cursor + 20 + entrySize > blockEnd) {
    return false; // truncated entry — histogram only
  }
  if (entryType === ROADSIGN) {
    dumpRoadsign(buffer, model, cursor);

    return true;
  }
  if (entryType === PARTICLE) {
    dumpParticle(buffer, model, cursor, entrySize);
  } else if (entryType === ESCALATOR) {
    dumpEscalator(buffer, model, cursor, entrySize);
  }

  return false;
}
