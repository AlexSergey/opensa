import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseObjectDat } from './object-dat.parser';

// Real object.dat copied into the committed tests/ tree (static/ is not committed).
const REAL = 'tests/original/data/object.dat';

describe('parseObjectDat', () => {
  describe('negative cases', () => {
    it('skips comments, blank lines and short rows', () => {
      const entries = parseObjectDat([';comment', '', '   ', 'tooShort, 1.0, 2.0'].join('\n'));
      expect(entries.size).toBe(0);
    });

    it('skips rows whose damage fields are not numeric', () => {
      // nine columns, but the damage multiplier/effect (cols 8/9) are non-numeric
      const entries = parseObjectDat('crate, 10.0, 10.0, 0.99, 0.03, 50.0, 0.0, x, y, 1');
      expect(entries.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('parses comma + whitespace separated columns into the kept fields', () => {
      const entries = parseObjectDat('cardboardbox2,\t\t20.0,\t\t20.0\t\t0.99,\t0.03,\t50.0,\t0.0,\t2.5,\t20,\t2');
      const entry = entries.get('cardboardbox2');
      expect(entry).toBeDefined();
      expect(entry?.mass).toBeCloseTo(20, 5);
      expect(entry?.colDamageMultiplier).toBeCloseTo(2.5, 5);
      expect(entry?.colDamageEffect).toBe(20);
    });

    it('reads real object.dat: bins keep change_model effect; indestructible props carry huge mass', () => {
      const entries = parseObjectDat(readFileSync(REAL, 'utf8'));
      expect(entries.size).toBeGreaterThan(500);

      // Shipped breakable props are authored with effect 0/1 (not 200) — the break gate is the
      // RW Breakable mesh, not this id; the multiplier still tunes how hard a hit they need.
      const bin = entries.get('binnt14_la');
      expect(bin?.colDamageEffect).toBe(1);
      expect(bin?.colDamageMultiplier).toBeGreaterThan(0);

      // Cutscene/fixed props are tuned indestructible via a huge mass.
      expect(entries.get('tar_gun1')?.mass).toBeGreaterThan(50000);
    });
  });
});
