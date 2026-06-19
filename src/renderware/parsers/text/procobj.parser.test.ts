import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseProcObj } from './procobj.parser';
import { parseSurfaceNames } from './surfinfo.parser';

// Real rows from data/procobj.dat (tab-separated, as shipped).
const SAMPLE = [
  '# SURFACE TYPE\t\tOBJECT NAME\t\tSPACING\tMINDIST\tMINROT\tMAXROT\tMINSCL\tMAXSCL \tMINSCLZ\tMAXSCLZ\tZOFFMIN\tzOFFMAX\tALIGN\tUSEGRID',
  'P_SAND\t\t\tsjmcacti2\t\t16.0\t60.0\t0\t360\t0.9\t1.0\t0.5\t1.0\t-0.2\t-0.2\t0\t0',
  'P_GRASS_DRY\t\tgen_tallgrsnew\t\t12.0\t50.0\t0\t360\t0.3\t1.0\t0.3\t1.0\t0.0\t0.0\t1\t0',
  '',
].join('\n');

function testData(file: string): null | string {
  const path = join(process.cwd(), 'tests', 'original', 'data', file);

  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

describe('parseProcObj', () => {
  describe('negative cases', () => {
    it('skips comments, blank lines and malformed rows', () => {
      expect(parseProcObj('# only comments\n\nP_SAND broken row\n')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses the 14-column whitespace rows, lowercasing names', () => {
      const rules = parseProcObj(SAMPLE);
      expect(rules).toHaveLength(2);
      expect(rules[0]).toEqual({
        align: false,
        maxRotation: 360,
        maxScale: 1,
        maxScaleZ: 1,
        minDistance: 60,
        minRotation: 0,
        minScale: 0.9,
        minScaleZ: 0.5,
        model: 'sjmcacti2',
        spacing: 16,
        surface: 'p_sand',
        useGrid: false,
        zOffsetMax: -0.2,
        zOffsetMin: -0.2,
      });
      expect(rules[1].align).toBe(true);
      expect(rules[1].surface).toBe('p_grass_dry');
    });

    it('parses the shipped data/procobj.dat — every rule lands on a real P_* surfinfo surface', () => {
      const text = testData('procobj.dat');
      if (text === null) {
        return; // fixture not present in this checkout
      }
      const rules = parseProcObj(text);
      expect(rules.length).toBeGreaterThan(80);
      expect(rules.every((rule) => rule.surface.startsWith('p_'))).toBe(true);
      expect(rules.every((rule) => rule.spacing > 0)).toBe(true);

      // Cross-check: every rule's surface must exist in surfinfo (the row index = COL material id the
      // scatter resolves against). Guards the two files staying in sync.
      const surfinfo = testData('surfinfo.dat');
      if (surfinfo !== null) {
        const surfaces = new Set(parseSurfaceNames(surfinfo));
        for (const rule of rules) {
          expect(surfaces.has(rule.surface), `surface ${rule.surface}`).toBe(true);
        }
      }
    });
  });
});
