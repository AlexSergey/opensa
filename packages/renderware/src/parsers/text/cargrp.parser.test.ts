import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseCarGroups } from './cargrp.parser';

const cargrpPath = join(process.cwd(), 'tests', 'original', 'data', 'cargrp.dat');

describe('parseCarGroups', () => {
  describe('negative cases', () => {
    it('returns nothing for blank input', () => {
      expect(parseCarGroups('')).toEqual([]);
    });

    it('skips the leading comment / blank lines', () => {
      expect(parseCarGroups('# file: cargrp.dat\n#\n\n')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses each group as a list of models, with the # label as comment (lowercased)', () => {
      const groups = parseCarGroups('Taxi, cabbie, mule\t# POPCYCLE_GROUP_WORKERS\nperen, blade # CRIMINALS');
      expect(groups).toEqual([
        { comment: 'POPCYCLE_GROUP_WORKERS', models: ['taxi', 'cabbie', 'mule'] },
        { comment: 'CRIMINALS', models: ['peren', 'blade'] },
      ]);
    });

    it('parses the real cargrp.dat (first group = workers, includes taxi/cabbie)', () => {
      if (!existsSync(cargrpPath)) {
        return;
      }
      const groups = parseCarGroups(readFileSync(cargrpPath, 'utf8'));
      expect(groups.length).toBeGreaterThan(20);
      expect(groups[0].models).toContain('taxi');
      expect(groups[0].comment).toContain('WORKERS');
    });
  });
});
