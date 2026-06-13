import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseProcObj } from '../parsers/text/procobj.parser';
import { procObjCategory, type ProcObjCategoryName } from './procobj-categories';

const CATEGORIES: ProcObjCategoryName[] = ['bushes', 'cacti', 'flowers', 'grass', 'rocks', 'trees', 'underwater'];

const procObjDat = join(process.cwd(), 'tests', 'data', 'procobj.dat');

describe('procObjCategory', () => {
  describe('negative cases', () => {
    it('falls back to bushes for an unknown model', () => {
      expect(procObjCategory('totally_unknown_model', 'p_grass')).toBe('bushes');
    });
  });

  describe('positive cases', () => {
    it('maps known models to their category (case-insensitive)', () => {
      expect(procObjCategory('sjmcacti2', 'p_sand')).toBe('cacti');
      expect(procObjCategory('GEN_TallGrsNew', 'p_grass_dry')).toBe('grass');
      expect(procObjCategory('pinebg_po', 'p_forest')).toBe('trees');
    });

    it('forces underwater for the sea-floor surface regardless of the model', () => {
      // A rubble (rocks) model on the sea floor must follow the underwater toggle, not rocks.
      expect(procObjCategory('p_rubble', 'p_underwaterbarren')).toBe('underwater');
      expect(procObjCategory('totally_unknown_model', 'p_underwaterbarren')).toBe('underwater');
    });

    it.skipIf(!existsSync(procObjDat))('classifies every model in the real procobj.dat into a valid category', () => {
      const rules = parseProcObj(readFileSync(procObjDat, 'utf8'));
      const seen = new Set<ProcObjCategoryName>();
      for (const rule of rules) {
        const category = procObjCategory(rule.model, rule.surface);
        expect(CATEGORIES).toContain(category);
        seen.add(category);
      }
      // The categorisation actually covers the real data — not everything falls through to bushes.
      expect(seen.size).toBeGreaterThan(1);
    });
  });
});
