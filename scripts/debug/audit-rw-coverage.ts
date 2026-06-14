import { parseDff } from '../../src/renderware/parsers/binary/dff';
import { parseTxd } from '../../src/renderware/parsers/binary/txd';
import { gameArg, openGameArchive } from '../lib/game';

/**
 * RenderWare coverage audit (plan 043): walk every DFF/TXD in the variant's real archive and
 * report what the data ACTUALLY contains vs what our parsers handle —
 * - DFF: chunk-type histogram (proper tree walk), multi-UV-layer geometries, 2dfx entry types,
 *   parse failures;
 * - TXD: d3dFormat/depth histogram and how many textures the classifier DROPS.
 * Run: `npx tsx scripts/debug/audit-rw-coverage.ts [--game original]`.
 */
const archive = openGameArchive(gameArg());

/** Containers whose data is a sequence of child chunks. */
const CONTAINERS = new Set([0x03, 0x06, 0x07, 0x08, 0x0e, 0x0f, 0x10, 0x14, 0x1a, 0x1b, 0x1f, 0x2b]);

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
  0x12: 'Light',
  0x14: 'Atomic',
  0x15: 'Raster',
  0x16: 'TexDictionary',
  0x1a: 'GeometryList',
  0x1b: 'AnimAnimation',
  0x1f: 'RightToRender',
  0x2b: 'UVAnimDict',
  0x105: 'MorphPLG',
  0x116: 'SkinPLG',
  0x11d: 'UserData',
  0x11e: 'HAnimPLG',
  0x120: 'MaterialEffects',
  0x135: 'UVAnimPLG',
  0x50e: 'BinMeshPLG',
  0x510: 'NativeDataPLG',
  0x253f2f3: 'PipelineSet',
  0x253f2f5: 'TexDictLink',
  0x253f2f6: 'SpecularMat',
  0x253f2f8: '2dEffect',
  0x253f2f9: 'ExtraVertColour',
  0x253f2fa: 'CollisionModel',
  0x253f2fb: 'GTAHAnim',
  0x253f2fc: 'ReflectionMat',
  0x253f2fd: 'Breakable',
  0x253f2fe: 'NodeName',
};

const chunkCounts = new Map<number, number>();
const fxTypes = new Map<number, number>();
let multiUv = 0;
let dffFailures = 0;
let dffTotal = 0;

function scanFx(buffer: Buffer, dataStart: number, end: number): void {
  if (dataStart + 4 > end) {
    return;
  }
  const count = buffer.readUInt32LE(dataStart);
  let cursor = dataStart + 4;
  for (let i = 0; i < count && cursor + 20 <= end; i += 1) {
    const entryType = buffer.readUInt32LE(cursor + 12);
    const entrySize = buffer.readUInt32LE(cursor + 16);
    fxTypes.set(entryType, (fxTypes.get(entryType) ?? 0) + 1);
    cursor += 20 + entrySize;
  }
}

function walkChunks(buffer: Buffer, start: number, end: number, depth: number): void {
  let offset = start;
  while (offset + 12 <= end) {
    const type = buffer.readUInt32LE(offset);
    const size = buffer.readUInt32LE(offset + 4);
    if (size > end - offset - 12 || (depth === 0 && !(type in NAMES))) {
      return;
    }
    chunkCounts.set(type, (chunkCounts.get(type) ?? 0) + 1);
    if (type === 0x0253f2f8) {
      scanFx(buffer, offset + 12, offset + 12 + size);
    }
    if (CONTAINERS.has(type) && size > 0) {
      walkChunks(buffer, offset + 12, offset + 12 + size, depth + 1);
    }
    offset += 12 + size;
  }
}

const txdFormats = new Map<string, number>();
let txdDropped = 0;
let txdTotal = 0;

for (const name of archive.names) {
  const lower = name.toLowerCase();
  const bytes = lower.endsWith('.dff') || lower.endsWith('.txd') ? archive.get(name) : null;
  if (!bytes) {
    continue;
  }
  const buffer = Buffer.from(bytes);
  if (lower.endsWith('.dff')) {
    dffTotal += 1;
    walkChunks(buffer, 0, buffer.length, 0);
    try {
      const clump = parseDff(bytes);
      if (clump.geometries.some((geometry) => geometry.numUVLayers > 1)) {
        multiUv += 1;
      }
    } catch {
      dffFailures += 1;
    }
  } else {
    try {
      const dict = parseTxd(bytes);
      txdTotal += dict.textures.length;
      for (const texture of dict.textures) {
        txdFormats.set(texture.format, (txdFormats.get(texture.format) ?? 0) + 1);
      }
      // Dropped textures don't appear in the dict — count raw TextureNative chunks to compare.
      const natives = countNatives(buffer);
      txdDropped += Math.max(0, natives - dict.textures.length);
    } catch {
      txdDropped += 1;
    }
  }
}

function countNatives(buffer: Buffer): number {
  let count = 0;
  for (let offset = 0; offset + 12 <= buffer.length; offset += 1) {
    if (buffer.readUInt32LE(offset) === 0x15 && buffer.readUInt32LE(offset + 8) >>> 16 !== 0) {
      const size = buffer.readUInt32LE(offset + 4);
      if (size > 0 && offset + 12 + size <= buffer.length) {
        count += 1;
        offset += 11; // skip ahead (the +1 of the loop completes the header)
      }
    }
  }

  return count;
}

console.log(`DFFs: ${dffTotal} (${dffFailures} failed to parse), multi-UV-layer models: ${multiUv}\n`);
console.log('chunk types across all DFFs:');
for (const [type, count] of [...chunkCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(NAMES[type] ?? `0x${type.toString(16)}`).padEnd(18)} ${count}`);
}
console.log('\n2dfx entry types:');
for (const [type, count] of [...fxTypes.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  type ${type}: ${count}`);
}
console.log(`\nTXD textures parsed: ${txdTotal}, dropped/unparsed: ${txdDropped}`);
console.log('formats:');
for (const [format, count] of txdFormats) {
  console.log(`  ${format}: ${count}`);
}
