import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCarcols } from './carcols.parser';

const carcolsPath = join(process.cwd(), 'tests', 'data', 'carcols.dat');

describe('parseCarcols', () => {
  describe('negative cases', () => {
    it('returns empty palette and car maps for blank input', () => {
      const result = parseCarcols('');
      expect(result.palette).toEqual([]);
      expect(result.cars.size).toBe(0);
      expect(result.cars4.size).toBe(0);
    });

    it('ignores rows outside any section', () => {
      const result = parseCarcols('0,0,0\n10,20,30');
      expect(result.palette).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses the palette, stripping inline comments', () => {
      const result = parseCarcols('col\n0,0,0\t# 0 black\n245,245,245\t# 1 white\nend');
      expect(result.palette).toEqual([
        [0, 0, 0],
        [245, 245, 245],
      ]);
    });

    it('parses 2-colour and 4-colour cars (names lowercased, trailing commas ignored)', () => {
      const result = parseCarcols(
        ['car', 'admiral, 34,34, 35,35', 'end', 'car4', 'camper, 1,31,1,0, 1,5,0,0,', 'end'].join('\n'),
      );
      expect(result.cars.get('admiral')).toEqual([
        [34, 34],
        [35, 35],
      ]);
      expect(result.cars4.get('camper')).toEqual([
        [1, 31, 1, 0],
        [1, 5, 0, 0],
      ]);
    });

    it('parses the real carcols.dat (palette + admiral/camper combos)', () => {
      if (!existsSync(carcolsPath)) {
        return;
      }
      const result = parseCarcols(readFileSync(carcolsPath, 'utf8'));
      expect(result.palette.length).toBeGreaterThan(100);
      expect(result.cars.get('admiral')?.length ?? 0).toBeGreaterThan(0);
      expect(result.cars4.get('camper')?.length ?? 0).toBeGreaterThan(0);
    });
  });
});
