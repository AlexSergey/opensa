import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Print a RenderWare file's chunk tree (type, offset, size) — diagnoses WHERE a plugin chunk
 * lives (e.g. a 2d Effect attached to the clump extension instead of a geometry extension).
 * Run: `npx tsx scripts/dump-chunks.ts static/img/gta3/se_bit_17.dff [filterHex]`.
 */
const NAMES: Record<number, string> = {
  0x01: 'Struct',
  0x02: 'String',
  0x03: 'Extension',
  0x06: 'Texture',
  0x07: 'Material',
  0x08: 'MaterialList',
  0x0e: 'FrameList',
  0x0f: 'Geometry',
  0x10: 'Clump',
  0x14: 'Atomic',
  0x1a: 'GeometryList',
  0x1f: 'TexDictionary',
  0x0253f2f8: '2dEffect',
  0x0253f2fe: 'NodeName',
  0x050e: 'BinMeshPLG',
};

const [path, filter] = process.argv.slice(2);
if (!path) {
  console.error('usage: npx tsx scripts/dump-chunks.ts <file> [filterHex]');
  process.exit(1);
}
const buffer = readFileSync(join(import.meta.dirname, '..', path));
const filterType = filter ? Number.parseInt(filter, 16) : null;

walk(0, buffer.length, 0);

/** Containers whose data is a sequence of child chunks. */
function hasChildren(type: number): boolean {
  return [0x03, 0x08, 0x0e, 0x0f, 0x10, 0x14, 0x1a, 0x1f, 0x07, 0x06].includes(type);
}

function walk(start: number, end: number, depth: number): void {
  let offset = start;
  while (offset + 12 <= end) {
    const type = buffer.readUInt32LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    if (size > end - offset - 12 || !(type in NAMES) && depth === 0) {
      return; // not a chunk boundary
    }
    const name = NAMES[type] ?? `0x${type.toString(16)}`;
    if (filterType === null || type === filterType || hasChildren(type)) {
      console.log(`${'  '.repeat(depth)}${name} @${offset} size=${size}`);
    }
    if (hasChildren(type) && size > 0) {
      // Children follow the (optional) leading Struct — walk the whole data range.
      walk(offset + 12, offset + 12 + size, depth + 1);
    }
    offset += 12 + size;
  }
}
