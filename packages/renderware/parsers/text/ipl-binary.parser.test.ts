import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseBinaryIpl } from './ipl-binary.parser';

/** Build a synthetic "bnry" IPL with the given INST records. */
function buildBinaryIpl(
  records: { id: number; interior: number; lod: number; pos: number[]; rot: number[] }[],
): ArrayBuffer {
  const headerSize = 76;
  const buffer = new ArrayBuffer(headerSize + records.length * 40);
  const view = new DataView(buffer);
  view.setUint8(0, 0x62); // b
  view.setUint8(1, 0x6e); // n
  view.setUint8(2, 0x72); // r
  view.setUint8(3, 0x79); // y
  view.setUint32(0x04, records.length, true);
  view.setUint32(0x1c, headerSize, true);
  records.forEach((r, i) => {
    const o = headerSize + i * 40;
    r.pos.forEach((v, k) => view.setFloat32(o + k * 4, v, true));
    r.rot.forEach((v, k) => view.setFloat32(o + 12 + k * 4, v, true));
    view.setUint32(o + 28, r.id, true);
    view.setInt32(o + 32, r.interior, true);
    view.setInt32(o + 36, r.lod, true);
  });

  return buffer;
}

describe('parseBinaryIpl', () => {
  it('decodes INST records (id-only, no model name)', () => {
    const buffer = buildBinaryIpl([
      { id: 620, interior: 0, lod: -1, pos: [1971.82, -1411.875, 14.25], rot: [0, 0, -1, 0] },
      { id: 1297, interior: 0, lod: 5, pos: [1842.13, -1406.43, 15.9], rot: [0, 0, 0, 1] },
    ]);
    const instances = parseBinaryIpl(buffer);
    expect(instances).toHaveLength(2);
    expect(instances[0].id).toBe(620);
    expect(instances[0].modelName).toBe('');
    expect(instances[0].position[0]).toBeCloseTo(1971.82, 2);
    expect(instances[0].lod).toBe(-1);
    expect(instances[1].id).toBe(1297);
    expect(instances[1].rotation).toEqual([0, 0, 0, 1]);
    expect(instances[1].lod).toBe(5);
  });

  it('rejects input without the bnry magic', () => {
    const buffer = new ArrayBuffer(64);
    expect(() => parseBinaryIpl(buffer)).toThrow(/binary IPL/);
  });
});

const streamPath = join(process.cwd(), 'tests', 'original', 'ipl_binary', 'lae_stream0.ipl');

describe.skipIf(!existsSync(streamPath))('parseBinaryIpl (real lae_stream0.ipl)', () => {
  it('decodes 319 instances with sane world positions', () => {
    const file = readFileSync(streamPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const instances = parseBinaryIpl(buffer);
    expect(instances).toHaveLength(319);
    expect(instances[0].id).toBe(620);
    expect(instances[0].position[0]).toBeCloseTo(1971.82, 1);
  });
});
