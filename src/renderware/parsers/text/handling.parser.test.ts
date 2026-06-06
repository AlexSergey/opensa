import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseHandling } from './handling.parser';

const handlingPath = join(process.cwd(), 'static', 'data', 'handling.cfg');

describe('parseHandling', () => {
  describe('negative cases', () => {
    it('returns an empty map for blank input', () => {
      expect(parseHandling('').size).toBe(0);
    });

    it('skips comments and the bike/boat/plane sub-tables', () => {
      const result = parseHandling([';comment', '!BIKE 1 2 3', '$PLANE 4 5 6', '%BOAT 7 8 9'].join('\n'));
      expect(result.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('keys car entries by id with their raw fields', () => {
      const result = parseHandling('ADMIRAL 1650.0 3851.4 2.0 F P');
      const entry = result.get('ADMIRAL');
      expect(entry?.id).toBe('ADMIRAL');
      expect(entry?.fields).toEqual(['1650.0', '3851.4', '2.0', 'F', 'P']);
    });

    it('parses the real handling.cfg (admiral + camper present)', () => {
      if (!existsSync(handlingPath)) {
        return;
      }
      const result = parseHandling(readFileSync(handlingPath, 'utf8'));
      expect(result.has('ADMIRAL')).toBe(true);
      expect(result.has('CAMPER')).toBe(true);
      expect(result.get('ADMIRAL')?.fields.length ?? 0).toBeGreaterThan(10);
    });
  });
});
