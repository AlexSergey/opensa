import type { IdeObjectDef } from './types';

import { cleanLines, sectionedParse } from './text-lines';

/**
 * Parse an IDE (item definition) file into its object definitions.
 *
 * Reads the `objs` section: `id, model, txd, drawDistance, flags`. Defensively
 * handles the SA variant that inserts a mesh count + multiple draw distances by
 * treating the first three cells as id/model/txd, the last as flags, and the
 * numeric cells between as draw distances (max wins). Other sections (`tobj`,
 * `path`, `2dfx`, `anim`, `txdp`) are out of scope and ignored.
 */
export function parseIde(text: string): IdeObjectDef[] {
  const objects: IdeObjectDef[] = [];

  sectionedParse(cleanLines(text), {
    objs: (row) => {
      const def = parseObjsRow(row);
      if (def) {
        objects.push(def);
      }
    },
  });

  return objects;
}

function parseObjsRow(cells: string[]): IdeObjectDef | null {
  if (cells.length < 5) {
    return null;
  }
  const id = Number(cells[0]);
  if (Number.isNaN(id)) {
    return null;
  }
  const distances = cells
    .slice(3, cells.length - 1)
    .map(Number)
    .filter((value) => !Number.isNaN(value));

  return {
    drawDistance: distances.length > 0 ? Math.max(...distances) : 0,
    flags: Number(cells[cells.length - 1]) || 0,
    id,
    modelName: cells[1],
    txdName: cells[2],
  };
}
