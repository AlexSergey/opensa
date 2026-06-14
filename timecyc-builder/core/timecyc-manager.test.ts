import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { HOURS, parseTimecyc, TIME_WEATHERS, WEATHER_NAMES } from '../../src/renderware/parsers/text/timecyc.parser';
import { TimecycManager } from './timecyc-manager';

const VANILLA = 'tests/data/timecyc.dat'; // 8-keyframe
const DAY24 = 'tests/data/timecyc_24h.dat'; // already 24h

describe('TimecycManager', () => {
  describe('negative cases', () => {
    it('throws when merging before a base is set', () => {
      expect(() => new TimecycManager().merge()).toThrow();
    });
  });

  describe('positive cases', () => {
    it('converts a vanilla base to 24h before merging (output is 24h)', async () => {
      const manager = new TimecycManager();
      await manager.setBase(VANILLA);
      expect(parseTimecyc(manager.merge())).toHaveLength(TIME_WEATHERS * HOURS); // 504 = 21 weathers × 24
    });

    it('keeps an already-24h base as 24h', async () => {
      const manager = new TimecycManager();
      await manager.setBase(DAY24);
      expect(parseTimecyc(manager.merge())).toHaveLength(WEATHER_NAMES.length * HOURS); // 552
    });

    it('converts a vanilla merge source on input and overlays only the selected prop/hours', async () => {
      const manager = new TimecycManager();
      await manager.setBase(DAY24);
      await manager.setTimecycToMerge([{ path: VANILLA, props: ['Sky top'], times: ['0h'] }]);
      const base = parseTimecyc(readFileSync(DAY24, 'utf8'));
      const out = parseTimecyc(manager.merge());
      // Only Sky top (cols 9..11) at hour 0 may differ; hour 1 and other columns stay as base.
      expect(out[1]).toEqual(base[1]);
      expect(out[0].slice(0, 9)).toEqual(base[0].slice(0, 9));
    });
  });
});
