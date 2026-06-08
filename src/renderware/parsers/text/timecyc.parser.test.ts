import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { convertTo24h, FIELDS, HOURS, parseTimecyc, TIME_WEATHERS } from './timecyc.parser';

const ROW_SIZE = FIELDS.reduce((n, f) => n + (f.kind === 'rgb' ? 3 : f.kind === 'rgba' ? 4 : 1), 0);
const base = readFileSync('tests/data/timecyc.dat', 'utf8');
const day24 = readFileSync('tests/data/timecyc_24h.dat', 'utf8');

describe('parseTimecyc', () => {
  describe('negative cases', () => {
    it('skips comment and blank lines', () => {
      expect(parseTimecyc('// header\n\n   \n')).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('parses the vanilla timecyc.dat as 23 weathers × 8 keyframes', () => {
      const rows = parseTimecyc(base);
      expect(rows).toHaveLength(23 * 8); // 184
      expect(rows[0]).toHaveLength(ROW_SIZE); // 52, padded with defaults
      expect(rows[0].slice(0, 3)).toEqual([22, 22, 22]); // first weather, midnight ambient
    });

    it('parses the 24h timecyc_24h.dat (≥ 21 weathers × 24 hours)', () => {
      const rows = parseTimecyc(day24);
      expect(rows.length).toBeGreaterThanOrEqual(TIME_WEATHERS * HOURS); // ≥ 504
      expect(rows[0]).toHaveLength(ROW_SIZE);
    });

    it('defaults the missing trailing field (dirMult) to 1', () => {
      const rows = parseTimecyc(base);
      expect(rows[0][ROW_SIZE - 1]).toBe(1); // dirMult absent in vanilla → default 1
    });
  });
});

describe('convertTo24h', () => {
  describe('positive cases', () => {
    it('expands the 21 time weathers to 24 hours each', () => {
      expect(convertTo24h(parseTimecyc(base))).toHaveLength(TIME_WEATHERS * HOURS); // 504
    });

    it('reproduces the bundled timecyc_24h.dat exactly (first 504 rows, byte-for-byte)', () => {
      const converted = convertTo24h(parseTimecyc(base));
      const expected = parseTimecyc(day24).slice(0, TIME_WEATHERS * HOURS);
      expect(converted).toEqual(expected); // JS port == the reference tool's output
    });

    it('copies the keyframe hours verbatim (midnight/5am/6am/7am/midday/7pm/8pm/10pm)', () => {
      const k = parseTimecyc(base);
      const h = convertTo24h(k);
      const keyToHour = [
        [0, 0],
        [1, 5],
        [2, 6],
        [3, 7],
        [4, 12],
        [5, 19],
        [6, 20],
        [7, 22],
      ];
      for (const [key, hour] of keyToHour) {
        expect(h[hour]).toEqual(k[key]); // weather 0
      }
    });

    it('interpolates between keyframes (1am = 1/5 from midnight toward 5am)', () => {
      const k = parseTimecyc(base);
      const h = convertTo24h(k);
      const a = k[0][3]; // skyTop.r at midnight
      const b = k[1][3]; // skyTop.r at 5am
      expect(h[1][3]).toBe(Math.trunc((4 / 5) * a + (1 / 5) * b));
    });
  });
});
