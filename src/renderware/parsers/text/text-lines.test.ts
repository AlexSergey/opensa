import { describe, expect, it } from 'vitest';

import { cleanLines, sectionedParse, splitRow } from './text-lines';

describe('cleanLines', () => {
  describe('negative cases', () => {
    it('drops blank lines and # comments', () => {
      expect(cleanLines('# a\n\n   \n# b')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('trims content lines and keeps order (CRLF tolerant)', () => {
      expect(cleanLines('  one  \r\ntwo\n# c\nthree')).toEqual(['one', 'two', 'three']);
    });
  });
});

describe('splitRow', () => {
  describe('positive cases', () => {
    it('splits on commas and trims each cell', () => {
      expect(splitRow('5000, gplane ,basicmain,  300 ')).toEqual(['5000', 'gplane', 'basicmain', '300']);
    });
  });
});

describe('sectionedParse', () => {
  describe('negative cases', () => {
    it('ignores rows in sections with no handler and never calls past `end`', () => {
      const rows: string[][] = [];
      sectionedParse(['inst', 'a, b', 'end', 'objs', 'c, d', 'end'], { inst: (r) => rows.push(r) });
      expect(rows).toEqual([['a', 'b']]); // objs has no handler → skipped
    });
  });

  describe('positive cases', () => {
    it('routes each row of a section to its handler (split into cells)', () => {
      const objs: string[][] = [];
      sectionedParse(['objs', '1, x', '2, y', 'end'], { objs: (r) => objs.push(r) });
      expect(objs).toEqual([
        ['1', 'x'],
        ['2', 'y'],
      ]);
    });
  });
});
