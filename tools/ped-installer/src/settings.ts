import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';

/** The line a ped's `*.settings.txt` may contribute — a `peds.ide` entry (only present when adding a new ped). */
export interface PedSettings {
  /** A `peds`-section line (`id, model, txd, type, …`) to merge into `peds.ide`. */
  pedsLine?: string;
}

/** A peds line needs at least `id, model, txd` — the columns `parsePedDefs` keeps. */
const MIN_PEDS_FIELDS = 3;

/**
 * Parse a `*.settings.txt` (blank-line-separated blocks) into the line it carries. Only one block kind is
 * recognised — a `peds`-section line — classified by **structure** (comma-separated, leading numeric id, ≥3
 * columns) and **validated** with the real `parsePedDefs` parser. Any other block is dropped.
 */
export function parsePedSettings(text: string): PedSettings {
  const out: PedSettings = {};
  for (const block of text.split(/\r?\n\s*\n/)) {
    const lines = block
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter((row) => row !== '');
    if (lines.length === 0) {
      continue;
    }
    if (isPedsLine(lines[0])) {
      out.pedsLine = lines[0];
    }
  }

  return out;
}

function isPedsLine(line: string): boolean {
  if (!line.includes(',')) {
    return false;
  }
  const cells = line.split(',').map((cell) => cell.trim());
  if (cells.length < MIN_PEDS_FIELDS || !/^\d+$/.test(cells[0])) {
    return false;
  }

  return parsePedDefs(`peds\n${line}\nend`).size > 0;
}
