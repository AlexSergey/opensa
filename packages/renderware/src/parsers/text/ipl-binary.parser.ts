import type { IplCarGenerator, IplInstance } from './types';

/**
 * Parse a binary ("bnry") IPL stream into placed instances.
 *
 * These files ship inside the IMG archive and hold the full-detail map
 * placement. Layout: header `char[4] "bnry"`, `u32 numInst` @0x04, `u32
 * instOffset` @0x1C; then `numInst` INST records of 40 bytes each —
 * position (3×f32, Z-up), rotation quaternion (4×f32), modelId (u32),
 * interior (i32), lod (i32). Binary IPLs key by **id only**, so `modelName`
 * is left empty and resolved from the IDE catalog by the walker.
 */
const INST_SIZE = 40;

/** A `CARS`-section record is 48 bytes: pos (3×f32) + angle (f32) + 8×i32 (model, colours, flags, 2 unused). */
const CARS_SIZE = 48;

/**
 * Parse a binary IPL's `CARS` section into car generators — SA's map-baked parked/spawned cars (the same
 * mechanic as the CLEO `0x014B` generators, but embedded in the map streams). Header: `u32 numCars` @0x14,
 * `u32 carsOffset` @0x3C; then `numCars` records of 48 bytes each — position (3×f32, Z-up), angle (f32),
 * modelId (i32, -1 = random area car), primary/secondary colour (i32, -1 = random), forceSpawn/alarm/doorLock
 * (i32), then 8 unused bytes. Returns `[]` when the section is empty. The engine's existing `parseBinaryIpl`
 * reads only the INST section, so these cars are otherwise dropped.
 */
export function parseBinaryCarGenerators(buffer: ArrayBuffer): IplCarGenerator[] {
  const view = new DataView(buffer);
  if (view.byteLength < 0x40 || readMagic(view) !== 'bnry') {
    throw new Error('Not a binary IPL: missing "bnry" header');
  }

  const numCars = view.getUint32(0x14, true);
  const carsOffset = view.getUint32(0x3c, true);

  const cars: IplCarGenerator[] = [];
  for (let i = 0; i < numCars; i += 1) {
    const offset = carsOffset + i * CARS_SIZE;
    cars.push({
      alarm: view.getInt32(offset + 32, true),
      angle: view.getFloat32(offset + 12, true),
      doorLock: view.getInt32(offset + 36, true),
      forceSpawn: view.getInt32(offset + 28, true),
      id: view.getInt32(offset + 16, true),
      position: [
        view.getFloat32(offset + 0, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ],
      primaryColor: view.getInt32(offset + 20, true),
      secondaryColor: view.getInt32(offset + 24, true),
    });
  }

  return cars;
}

export function parseBinaryIpl(buffer: ArrayBuffer): IplInstance[] {
  const view = new DataView(buffer);
  if (view.byteLength < 32 || readMagic(view) !== 'bnry') {
    throw new Error('Not a binary IPL: missing "bnry" header');
  }

  const numInst = view.getUint32(0x04, true);
  const instOffset = view.getUint32(0x1c, true);

  const instances: IplInstance[] = [];
  for (let i = 0; i < numInst; i += 1) {
    const offset = instOffset + i * INST_SIZE;
    instances.push({
      id: view.getUint32(offset + 28, true),
      interior: view.getInt32(offset + 32, true),
      lod: view.getInt32(offset + 36, true),
      modelName: '',
      position: [
        view.getFloat32(offset + 0, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ],
      rotation: [
        view.getFloat32(offset + 12, true),
        view.getFloat32(offset + 16, true),
        view.getFloat32(offset + 20, true),
        view.getFloat32(offset + 24, true),
      ],
    });
  }

  return instances;
}

function readMagic(view: DataView): string {
  return String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
}
