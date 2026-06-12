import { cleanLines } from './text-lines';

/** One `procobj.dat` rule: scatter `model` over collision faces of `surface` (plan 042). */
export interface ProcObjRule {
  /** Align the object to the surface normal (otherwise stays world-upright). */
  align: boolean;
  /** Max placement rotation around Z, degrees. */
  maxRotation: number;
  /** Max XY scale (vanilla note: collision is never scaled — pure decoration here). */
  maxScale: number;
  maxScaleZ: number;
  /** Vanilla draw/creation distance for this rule (the dat's MINDIST column). */
  minDistance: number;
  minRotation: number;
  minScale: number;
  minScaleZ: number;
  /** Object model name, lowercased (defs live in the regular IDE catalog). */
  model: string;
  /** Average spacing: one object per `spacing` square metres of face area. */
  spacing: number;
  /** Surface name, lowercased — matches a `surfinfo.dat` row name (e.g. `p_grass_dry`). */
  surface: string;
  /** Place on a rigid grid instead of randomly across the triangle (unused by vanilla data). */
  useGrid: boolean;
  /** Random Z offset range added to the placement height (sinks rocks/rubble into the ground). */
  zOffsetMax: number;
  zOffsetMin: number;
}

const COLUMNS = 14;

/**
 * Parse `data/procobj.dat` — SA's procedural ground-clutter table. Whitespace-separated columns
 * (not comma rows like IDE/IPL): `surface model spacing minDist minRot maxRot minScl maxScl
 * minSclZ maxSclZ zOffMin zOffMax align useGrid`. Comments (`#`) and blank lines are dropped;
 * malformed rows are skipped.
 */
export function parseProcObj(text: string): ProcObjRule[] {
  const rules: ProcObjRule[] = [];
  for (const line of cleanLines(text)) {
    const cells = line.split(/\s+/);
    if (cells.length < COLUMNS) {
      continue;
    }
    const numbers = cells.slice(2).map(Number);
    if (numbers.some(Number.isNaN)) {
      continue;
    }
    rules.push({
      align: numbers[10] !== 0,
      maxRotation: numbers[3],
      maxScale: numbers[5],
      maxScaleZ: numbers[7],
      minDistance: numbers[1],
      minRotation: numbers[2],
      minScale: numbers[4],
      minScaleZ: numbers[6],
      model: cells[1].toLowerCase(),
      spacing: numbers[0],
      surface: cells[0].toLowerCase(),
      useGrid: numbers[11] !== 0,
      zOffsetMax: numbers[9],
      zOffsetMin: numbers[8],
    });
  }

  return rules;
}
