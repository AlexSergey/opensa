import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseZones } from './zon.parser';

// The real map.zon boxes (name, type, x1,y1,z1, x2,y2,z2, level, label).
const MAP_ZON = `zone
Vegas, 3, 685.0, 476.093, -500.0, 3000.0, 3000.0, 500.0, 3, UNUSED
SF01, 3, -3000.0, -742.306, -500.0, -1270.53, 1530.24, 500.0, 2, UNUSED
LA01, 3, 480.0, -3000.0, -500.0, 3000.0, -850.0, 500.0, 1, UNUSED
end`;

const ZON_PATH = join(process.cwd(), 'tests', 'original', 'data', 'info.zon');

describe('parseZones', () => {
  describe('negative cases', () => {
    it('returns no zones for empty / section-only text', () => {
      expect(parseZones('zone\nend\n')).toEqual([]);
    });

    it('skips malformed lines (too few fields, non-numeric bounds, non-numeric level)', () => {
      expect(parseZones('zone\nBad, 3, 1, 2\nNope, 3, a, b, 0, c, d, 0, 1, X\nend')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses each box with its level and normalised min/max', () => {
      const zones = parseZones(MAP_ZON);
      expect(zones.map((z) => z.level)).toEqual([3, 2, 1]);
      const sf = zones.find((z) => z.name === 'SF01');
      expect(sf?.min).toEqual([-3000, -742.306]);
      expect(sf?.max).toEqual([-1270.53, 1530.24]);
    });
  });

  describe.skipIf(!existsSync(ZON_PATH))('real info.zon', () => {
    it('parses every named district zone (Bone County desert + a normal box)', () => {
      const zones = parseZones(readFileSync(ZON_PATH, 'latin1'));
      expect(zones.length).toBeGreaterThan(300);
      const bone = zones.find((z) => z.name === 'BONE'); // the Bone County desert county box
      expect(bone?.min).toEqual([-480.539, 596.349]);
      expect(bone?.max).toEqual([869.461, 2993.87]);
    });
  });
});
