import { describe, expect, it } from 'vitest';

import { sortMods } from './install';

describe('sortMods', () => {
  describe('positive cases', () => {
    it('sorts plain alphabetical, not numeric (mod1, mod10, mod2)', () => {
      expect(sortMods(['mod2', 'mod10', 'mod1'])).toEqual(['mod1', 'mod10', 'mod2']);
    });

    it('is case-insensitive ascending', () => {
      expect(sortMods(['B_mod', 'a_mod', 'C_mod'])).toEqual(['a_mod', 'B_mod', 'C_mod']);
    });

    it('does not mutate the input', () => {
      const input = ['b', 'a'];
      sortMods(input);

      expect(input).toEqual(['b', 'a']);
    });
  });
});
