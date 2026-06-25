import type { IplInstance } from './types';

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
