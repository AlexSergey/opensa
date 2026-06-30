import { describe, expect, it } from 'vitest';

import { ADDITIVE_DAT, mergeDataFile } from './data-merge';

const PROCOBJ = ADDITIVE_DAT['procobj.dat'];
const OBJECT = ADDITIVE_DAT['object.dat'];

/** A procobj row: `surface model spacing …` padded to ≥ 14 whitespace columns. */
const proc = (surface: string, model: string, spacing: string): string =>
  [surface, model, spacing, '60', '0', '360', '1', '1', '1', '1', '0', '0', '0', '0'].join('\t');

describe('mergeDataFile (procobj.dat — keyed by surface+model)', () => {
  describe('negative cases', () => {
    it('returns the base unchanged when no mod row parses (comments only)', () => {
      const base = `# header\n${proc('p_sand', 'cactus', '16')}\n`;

      expect(mergeDataFile(base, ['# just a comment'], PROCOBJ)).toBe(base);
    });
  });

  describe('positive cases', () => {
    it('replaces a stock rule in place (no duplicate (surface,model) → no double scatter) and keeps the rest', () => {
      const base = `# header\n${proc('p_sand', 'cactus', '16')}\n${proc('p_grass', 'fern', '10')}\n`;
      const out = mergeDataFile(base, [proc('p_sand', 'cactus', '99')], PROCOBJ).split('\n');

      expect(out.filter((line) => /^p_sand\s+cactus/i.test(line))).toHaveLength(1); // replaced, not duplicated
      expect(out.some((line) => /^p_sand\s+cactus\s+99/i.test(line))).toBe(true);
      expect(out.some((line) => /^p_grass\s+fern\s+10/i.test(line))).toBe(true); // untouched
      expect(out[0]).toBe('# header'); // comment kept
    });

    it('appends a new (surface,model) rule after the stock content', () => {
      const base = `${proc('p_sand', 'cactus', '16')}\n`;
      const out = mergeDataFile(base, [proc('p_dirt', 'weed', '12')], PROCOBJ);

      expect(out).toContain('p_sand\tcactus');
      expect(out.trimEnd().endsWith(proc('p_dirt', 'weed', '12'))).toBe(true);
    });

    it('folds several mod files, last write winning per key', () => {
      const out = mergeDataFile('', [proc('p_sand', 'cactus', '16'), proc('p_sand', 'cactus', '88')], PROCOBJ);

      expect(out.split('\n').filter((line) => line.trim() !== '')).toHaveLength(1);
      expect(out).toContain('p_sand\tcactus\t88');
    });
  });
});

describe('mergeDataFile (object.dat — keyed by model)', () => {
  describe('positive cases', () => {
    it('replaces the model row and appends a new one, keeping `;` comments + other models', () => {
      const base = '; tuning\ncrate, 50, 9, 0, 0, 0, 0, 1, 0\nbarrel, 80, 9, 0, 0, 0, 0, 1, 0\n';
      const out = mergeDataFile(base, ['crate, 99, 9, 0, 0, 0, 0, 2, 0\nflowerpot, 5, 1, 0, 0, 0, 0, 1, 0'], OBJECT);

      expect(out).toContain('crate, 99, 9, 0, 0, 0, 0, 2, 0'); // replaced
      expect(out).not.toContain('crate, 50');
      expect(out).toContain('barrel, 80'); // untouched
      expect(out).toContain('; tuning'); // comment kept
      expect(out).toContain('flowerpot, 5, 1, 0, 0, 0, 0, 1, 0'); // appended
    });
  });
});
