import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { describe, expect, it } from 'vitest';

import { mergePeds } from './merge';

const BASE = [
  'peds',
  '7, male01, male01, CIVMALE, STAT, man, 0, 0',
  '9, bfori, bfori, CIVFEMALE, STAT, woman, 0, 0',
  'end',
].join('\n');

describe('mergePeds', () => {
  describe('negative cases', () => {
    it('leaves the text unchanged when there is no peds section', () => {
      const text = 'objs\n1, foo, bar\nend';
      expect(mergePeds(text, '9, bfori, bfori_hd, CIVFEMALE, STAT, woman, 0, 0')).toBe(text);
    });
  });

  describe('positive cases', () => {
    it('replaces the line of an existing model in place (by model col 1)', () => {
      const line = '9, bfori, bfori_hd, CIVFEMALE, STAT, woman, 0, 0';
      const out = mergePeds(BASE, line);

      const defs = parsePedDefs(out);
      expect(defs.get('bfori')?.txd).toBe('bfori_hd'); // swapped txd
      expect(defs.size).toBe(2); // no new entry — replaced in place
      expect(out.split('\n').filter((l) => l.includes('bfori'))).toHaveLength(1);
    });

    it('appends a new model before the section end', () => {
      const line = '280, cesar, cesar, CIVMALE, STAT, gang1, 0, 0';
      const out = mergePeds(BASE, line);
      const lines = out.split('\n');

      expect(parsePedDefs(out).get('cesar')?.model).toBe('cesar');
      expect(lines[lines.length - 2]).toBe(line); // inserted just before `end`
      expect(lines[lines.length - 1]).toBe('end');
    });

    it('preserves CRLF line endings', () => {
      const crlf = BASE.replace(/\n/g, '\r\n');
      const out = mergePeds(crlf, '280, cesar, cesar, CIVMALE, STAT, gang1, 0, 0');
      expect(out.includes('\r\n')).toBe(true);
      expect(out.includes('\n\n')).toBe(false); // no bare-LF rows mixed in
    });
  });
});
