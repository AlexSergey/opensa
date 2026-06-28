import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { guardOut } from './install';

describe('guardOut', () => {
  describe('negative cases', () => {
    it('refuses the filesystem root as --out', () => {
      expect(() => guardOut(`${sep}`, `${sep}game`, `${sep}in`)).toThrow(/filesystem root/);
    });

    it('refuses --out equal to --game or --in', () => {
      expect(() => guardOut(`${sep}a${sep}game`, `${sep}a${sep}game`, `${sep}a${sep}in`)).toThrow(/must differ/);
      expect(() => guardOut(`${sep}a${sep}in`, `${sep}a${sep}game`, `${sep}a${sep}in`)).toThrow(/must differ/);
    });

    it('refuses --out that contains --game / --in (would wipe them)', () => {
      expect(() => guardOut(`${sep}a`, `${sep}a${sep}game`, `${sep}b${sep}in`)).toThrow(/must not contain/);
    });
  });

  describe('positive cases', () => {
    it('allows a distinct --out', () => {
      expect(() => guardOut(`${sep}a${sep}out`, `${sep}a${sep}game`, `${sep}a${sep}in`)).not.toThrow();
    });
  });
});
