import type { GtaDat } from './types';

import { cleanLines } from './text-lines';

/**
 * Parse a `gta.dat` master file into its IMG / IDE / IPL references.
 *
 * Each meaningful line is `DIRECTIVE  PATH` (whitespace-separated); `#` lines
 * and blanks are ignored. Only IMG/IDE/IPL are collected — other directives
 * (COLFILE, TEXDICTION, MODELFILE, SPLASH, CDIMAGE, …) are skipped. Paths are
 * kept verbatim; URL normalization happens in the map layer.
 */
export function parseGtaDat(text: string): GtaDat {
  const result: GtaDat = { ide: [], img: [], ipl: [] };

  for (const line of cleanLines(text)) {
    const splitAt = line.search(/\s/);
    if (splitAt === -1) {
      continue;
    }
    const directive = line.slice(0, splitAt).toUpperCase();
    const path = line.slice(splitAt + 1).trim();
    switch (directive) {
      case 'IDE':
        result.ide.push(path);
        break;
      case 'IMG':
        result.img.push(path);
        break;
      case 'IPL':
        result.ipl.push(path);
        break;
      default:
        break;
    }
  }

  return result;
}
