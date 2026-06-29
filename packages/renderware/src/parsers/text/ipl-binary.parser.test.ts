import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseBinaryCarGenerators, parseBinaryIpl } from './ipl-binary.parser';

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

/** Build a synthetic "bnry" IPL with the given CARS records (numCars @0x14, carsOffset @0x3C). */
function buildBinaryIplCars(
  cars: {
    alarm: number;
    angle: number;
    doorLock: number;
    forceSpawn: number;
    id: number;
    pos: number[];
    prim: number;
    sec: number;
  }[],
): ArrayBuffer {
  const headerSize = 76;
  const buffer = new ArrayBuffer(headerSize + cars.length * 48);
  const view = new DataView(buffer);
  view.setUint8(0, 0x62); // b
  view.setUint8(1, 0x6e); // n
  view.setUint8(2, 0x72); // r
  view.setUint8(3, 0x79); // y
  view.setUint32(0x14, cars.length, true); // numCars
  view.setUint32(0x3c, headerSize, true); // carsOffset
  cars.forEach((c, i) => {
    const o = headerSize + i * 48;
    c.pos.forEach((v, k) => view.setFloat32(o + k * 4, v, true));
    view.setFloat32(o + 12, c.angle, true);
    view.setInt32(o + 16, c.id, true);
    view.setInt32(o + 20, c.prim, true);
    view.setInt32(o + 24, c.sec, true);
    view.setInt32(o + 28, c.forceSpawn, true);
    view.setInt32(o + 32, c.alarm, true);
    view.setInt32(o + 36, c.doorLock, true);
  });

  return buffer;
}

describe('parseBinaryCarGenerators', () => {
  describe('negative cases', () => {
    it('rejects input without the bnry magic', () => {
      expect(() => parseBinaryCarGenerators(new ArrayBuffer(64))).toThrow(/binary IPL/);
    });

    it('returns no cars when the CARS section is empty', () => {
      const buffer = buildBinaryIplCars([]);
      expect(parseBinaryCarGenerators(buffer)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('decodes a specific-model car and a random one (-1) with their fields', () => {
      const buffer = buildBinaryIplCars([
        { alarm: 0, angle: Math.PI, doorLock: 0, forceSpawn: 0, id: 452, pos: [10, 20, 3], prim: 6, sec: 1 },
        { alarm: 50, angle: 0, doorLock: 25, forceSpawn: 1, id: -1, pos: [-5, 7, 1], prim: -1, sec: -1 },
      ]);

      const cars = parseBinaryCarGenerators(buffer);

      expect(cars).toHaveLength(2);
      expect(cars[0]).toEqual({
        alarm: 0,
        angle: Math.fround(Math.PI),
        doorLock: 0,
        forceSpawn: 0,
        id: 452,
        position: [10, 20, 3],
        primaryColor: 6,
        secondaryColor: 1,
      });
      expect(cars[1].id).toBe(-1); // random area car
      expect(cars[1].primaryColor).toBe(-1); // random colour
      expect(cars[1].alarm).toBe(50);
    });
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

  it('decodes its CARS section (2 random-car generators in LA)', () => {
    const file = readFileSync(streamPath);
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    const cars = parseBinaryCarGenerators(buffer);
    expect(cars).toHaveLength(2);
    expect(cars.map((c) => c.id)).toEqual([-1, -1]); // both random area cars
    expect(cars[0].position[0]).toBeCloseTo(2008.3, 1);
    expect(cars[1].angle).toBeCloseTo(-Math.PI, 2); // ≈ -π → radians, facing south
  });
});
