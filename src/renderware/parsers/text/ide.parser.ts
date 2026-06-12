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
 * - `anim` (animated objects): `id, model, txd, animName, drawDistance, flags` —
 *   `animName` is the IFP file holding the model's looping clip (plan 041), kept
 *   on `def.anim`; the rest parses like `objs` (the non-numeric name is filtered
 *   out by the draw-distance parsing).
 *
 * `tobj` (time-of-day objects) is a distinct kind handled separately — see
 * {@link parseTimedObjects}. Other sections (`path`, `2dfx`, `txdp`, …) are not
 * placeable and are ignored.
 */
export function parseIde(text: string): IdeObjectDef[] {
  const objects: IdeObjectDef[] = [];
  sectionedParse(cleanLines(text), {
    anim: (row) => {
      const def = parseObjsRow(row);
      if (def && row[3]) {
        def.anim = row[3].toLowerCase();
        objects.push(def);
      }
    },
    objs: (row) => {
      const def = parseObjsRow(row);
      if (def) {
        objects.push(def);
      }
    },
  });

  return objects;
}

/**
 * Parse an IDE file's `tobj` (time-of-day) object definitions. Same columns as
 * `objs` plus a trailing `timeOn, timeOff` (hours) pair, captured onto `def.time`
 * so a system can gate visibility by the game hour. Kept separate from the plain
 * render catalog (their model often overlaps a daytime variant).
 */
export function parseTimedObjects(text: string): IdeObjectDef[] {
  const objects: IdeObjectDef[] = [];
  sectionedParse(cleanLines(text), {
    tobj: (row) => {
      const timed = row.length >= 7;
      const def = parseObjsRow(timed ? row.slice(0, -2) : row);
      if (!def) {
        return;
      }
      if (timed) {
        const on = Number(row[row.length - 2]);
        const off = Number(row[row.length - 1]);
        if (!Number.isNaN(on) && !Number.isNaN(off)) {
          def.time = { off, on };
        }
      }
      objects.push(def);
    },
  });

  return objects;
}

/**
 * Parse an IDE file's `txdp` (TXD-parent) section into `[childTxd, parentTxd]` pairs (both lowercased).
 * A child TXD inherits any texture it lacks from its parent — the "optimized map" (and mods shipped that
 * way) deduplicate by hoisting shared textures into regional `*_gene` parents and stripping the children.
 * Names only (no extension); the texture resolver walks this chain (see `archive/asset-cache.getTextures`).
 */
export function parseTxdParents(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  sectionedParse(cleanLines(text), {
    txdp: (row) => {
      if (row.length >= 2 && row[0] && row[1]) {
        pairs.push([row[0].toLowerCase(), row[1].toLowerCase()]);
      }
    },
  });

  return pairs;
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
