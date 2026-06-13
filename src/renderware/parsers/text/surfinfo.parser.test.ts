import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSurfaceNames } from './surfinfo.parser';

const datPath = join(process.cwd(), 'tests', 'data', 'surfinfo.dat');
const datExists = existsSync(datPath);

describe('parseSurfaceNames', () => {
  describe('negative cases', () => {
    it('drops comment (#) and blank lines', () => {
      expect(parseSurfaceNames('# header\n\n   \n')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reads the leading name token of each row, lowercased', () => {
      expect(parseSurfaceNames('DEFAULT   ROAD 1.0\nTARMAC_FUCKED  ROAD 1.0')).toEqual(['default', 'tarmac_fucked']);
    });

    it.skipIf(!datExists)('parses the real surfinfo.dat (row index = COL material id)', () => {
      const names = parseSurfaceNames(readFileSync(datPath, 'utf8'));
      expect(names).toHaveLength(179); // SA's fixed surface table
      expect(names[0]).toBe('default');
      expect(names[1]).toBe('tarmac');
      // The P_* procedural-object surfaces (procobj.dat rules key off these by material id).
      expect(names[74]).toBe('p_sand');
      expect(names.filter((n) => n.startsWith('p_')).length).toBeGreaterThan(0);
    });
  });
});
