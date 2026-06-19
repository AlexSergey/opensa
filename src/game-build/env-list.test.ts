import { describe, expect, it } from 'vitest';

import { parseModelList } from './env-list';

describe('parseModelList', () => {
  describe('negative cases', () => {
    it('returns an empty list for unset or empty values', () => {
      expect(parseModelList(undefined)).toEqual([]);
      expect(parseModelList('')).toEqual([]);
      expect(parseModelList(' , ')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses a bare comma list (lowercased, trimmed)', () => {
      expect(parseModelList('Admiral, COMET')).toEqual(['admiral', 'comet']);
    });

    it('parses a JS-array-style value with quotes/brackets', () => {
      expect(parseModelList('[\'admiral\', "comet"]')).toEqual(['admiral', 'comet']);
    });
  });
});
