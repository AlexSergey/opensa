import type { IdeObjectDef } from './types';

import { cleanLines, sectionedParse } from './text-lines';

/**
 * Parse an IDE (item definition) file into its *renderable* object definitions.
 *
 * Reads the sections whose objects are placed and drawn as ordinary world geometry:
 * - `objs`: `id, model, txd, drawDistance, flags`. Defensively handles the SA
 *   variant that inserts a mesh count + multiple draw distances by treating the
 *   first three cells as id/model/txd, the last as flags, and the numeric cells
 *   between as draw distances (max wins).
 * - `anim` (animated objects): `id, model, txd, animName, drawDistance, flags`;
 *   the non-numeric `animName` is filtered out by the draw-distance parsing.
 *
 * `tobj` (time-of-day objects) is a distinct kind handled separately — see
 * {@link parseTimedObjects}. Other sections (`path`, `2dfx`, `txdp`, …) are not
 * placeable and are ignored.
 */
export function parseIde(text: string): IdeObjectDef[] {
  return collectObjs(text, ['anim', 'objs']);
}

/**
 * Parse an IDE file's `tobj` (time-of-day) object definitions. These are a
 * separate kind — they only appear during a time-of-day window in the game — so
 * they are kept out of the render catalog for now. Same columns as `objs` plus a
 * trailing `timeOn, timeOff` pair, which is stripped.
 *
 * TODO: render time-of-day objects with proper day/night gating (see memory).
 */
export function parseTimedObjects(text: string): IdeObjectDef[] {
  const objects: IdeObjectDef[] = [];
  sectionedParse(cleanLines(text), {
    tobj: (row) => {
      const def = parseObjsRow(row.length >= 7 ? row.slice(0, -2) : row);
      if (def) {
        objects.push(def);
      }
    },
  });

  return objects;
}

function collectObjs(text: string, sections: readonly string[]): IdeObjectDef[] {
  const objects: IdeObjectDef[] = [];
  const handler = (row: string[]): void => {
    const def = parseObjsRow(row);
    if (def) {
      objects.push(def);
    }
  };

  sectionedParse(cleanLines(text), Object.fromEntries(sections.map((section) => [section, handler])));

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
