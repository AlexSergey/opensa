import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCarmods } from './carmods.parser';

const carmodsPath = join(process.cwd(), 'tests', 'original', 'data', 'carmods.dat');

describe('parseCarmods', () => {
  describe('negative cases', () => {
    it('returns empty sections for blank input', () => {
      const result = parseCarmods('');
      expect(result.links).toEqual([]);
      expect(result.mods.size).toBe(0);
      expect(result.wheels.size).toBe(0);
    });

    it('ignores rows outside any section', () => {
      expect(parseCarmods('admiral, nto_b_l\nfoo, bar').mods.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('parses link / mods / wheel sections (model names lowercased, comments stripped)', () => {
      const result = parseCarmods(
        [
          'link',
          'bntl_b_ov, bntr_b_ov # a pair',
          'end',
          'mods',
          'Admiral, nto_b_l, nto_b_s, nto_b_tw',
          'end',
          'wheel',
          '0, wheel_gn1, wheel_gn2',
          'end',
        ].join('\n'),
      );
      expect(result.links).toEqual([['bntl_b_ov', 'bntr_b_ov']]);
      expect(result.mods.get('admiral')).toEqual(['nto_b_l', 'nto_b_s', 'nto_b_tw']);
      expect(result.wheels.get(0)).toEqual(['wheel_gn1', 'wheel_gn2']);
    });

    it('parses the real carmods.dat (admiral mods + wheel groups + links)', () => {
      if (!existsSync(carmodsPath)) {
        return;
      }
      const result = parseCarmods(readFileSync(carmodsPath, 'utf8'));
      expect(result.mods.get('admiral')).toEqual(['nto_b_l', 'nto_b_s', 'nto_b_tw']);
      expect(result.wheels.size).toBeGreaterThan(0);
      expect(result.links.length).toBeGreaterThan(0);
    });
  });
});
