import type { IplInstance } from './types';

import { cleanLines, sectionedParse } from './text-lines';

/**
 * Parse an IPL (item placement) file into its placed instances.
 *
 * Reads the `inst` section: `id, model, interior, posX, posY, posZ, rotX, rotY,
 * rotZ, rotW, lod` (11 columns). Other sections (`cull`, `path`, `grge`, `enex`,
 * `pick`, `jump`, `tcyc`, `auzo`, `mult`) are out of scope and ignored.
 */
export function parseIpl(text: string): IplInstance[] {
  const instances: IplInstance[] = [];

  sectionedParse(cleanLines(text), {
    inst: (row) => {
      const instance = parseInstRow(row);
      if (instance) {
        instances.push(instance);
      }
    },
  });

  return instances;
}

function parseInstRow(cells: string[]): IplInstance | null {
  if (cells.length < 11) {
    return null;
  }
  const id = Number(cells[0]);
  if (Number.isNaN(id)) {
    return null;
  }

  return {
    id,
    interior: Number(cells[2]),
    lod: Number(cells[10]),
    modelName: cells[1],
    position: [Number(cells[3]), Number(cells[4]), Number(cells[5])],
    rotation: [Number(cells[6]), Number(cells[7]), Number(cells[8]), Number(cells[9])],
  };
}
